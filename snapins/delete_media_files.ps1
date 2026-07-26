# ============================================================
# DANGER: DELETES FILES PERMANENTLY
#
# This script scans drives and deletes media files.
# By default it DELETES files for real. Use --dryRun to preview.
#
# USAGE (run as Administrator for task management):
#
#   # Default: scan all fixed drives, delete all media
#   delete_media_files.ps1
#
#   # Preview only (no actual deletion)
#   delete_media_files.ps1 --dryRun
#
#   # Install a scheduled task that cleans USB drives on insert
#   delete_media_files.ps1 --usbTask true
#
#   # Install a daily scheduled task that deletes local files older than 5h
#   # (sub-day durations auto-repeat the task throughout the day)
#   delete_media_files.ps1 --fileTimeout 5H
#
#   # Remove all installed scheduled tasks
#   delete_media_files.ps1 --remove
#
#   # DIAGNOSTIC (run on a test box): log USB/device events for a window so you
#   # can identify which EventID fires on insert. Insert a USB during the window.
#   delete_media_files.ps1 --usbDiag        # default 120s
#   delete_media_files.ps1 --usbDiag 60     # custom window (seconds)
#
# DURATION FORMAT (--fileTimeout / --olderThan):
#   Combinations of <number><unit> where unit is one of:
#     W = weeks, D = days, H = hours, M = minutes, S = seconds
#   Examples: 5H, 30M, 2D, 1W, 1D2H30M, 90S, 1.5H
#
# All output is logged to C:\snapin\DeleteMediaFiles_<timestamp>.log
# ============================================================

# --- Log Configuration ---
 $LogDir = "C:\snapin"
if (-not (Test-Path -Path $LogDir)) { New-Item -Path $LogDir -ItemType Directory -Force | Out-Null }

# Retain recent log files for auditing; prune overflow/old entries only.
# (Previous behavior wiped ALL history on every invocation, including the
#  repeated sub-day age-cleanup and every USB insert, defeating auditing.)
$existingLogs = Get-ChildItem -Path $LogDir -Filter "DeleteMediaFiles_*.log" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
$retainCount = 20
if ($existingLogs.Count -gt $retainCount) {
    $existingLogs | Select-Object -Skip $retainCount |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
$ageCutoff = (Get-Date).AddDays(-7)
$existingLogs | Where-Object { $_.LastWriteTime -lt $ageCutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue

 $LogFilePath = "$LogDir\DeleteMediaFiles_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Logging function
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [string]$Color = "Gray"
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFilePath -Value $logEntry
    # Also mirror to console for interactive runs
    Write-Host $logEntry -ForegroundColor $Color
}

# --- Media targets ---
# Media extensions to target (for Get-ChildItem filter)
 $mediaWildcardFilters = @(
    "*.mp3", "*.wav", "*.flac", "*.aac", "*.wma", "*.ogg", "*.m4a",
    "*.mp4", "*.avi", "*.mkv", "*.mov", "*.wmv", "*.flv", "*.webm", "*.m4v",
    "*.jpg", "*.jpeg", "*.png", "*.gif", "*.bmp", "*.tiff", "*.raw", "*.psd", "*.svg"
)

# Strict list of extensions (for the failsafe check before deletion)
# This prevents any accidental deletion of non-media files
 $strictExtensions = @(
    ".mp3", ".wav", ".flac", ".aac", ".wma", ".ogg", ".m4a",
    ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".raw", ".psd", ".svg"
)

# Top-level Windows standard folders to EXCLUDE
 $excludedDirs = @(
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "System Volume Information",
    "Recovery",
    "PerfLogs"
)

# --- Task names (shared by install/remove) ---
 $UsbTaskName = "DeleteMediaFiles_USBInsert"
 $AgeTaskName = "DeleteMediaFiles_AgeCleanup"
 $ScriptPath  = $PSCommandPath

# ============================================================
# Helper: parse a duration string into a TimeSpan
# Supports: W (weeks), D (days), H (hours), M (minutes), S (seconds)
# Examples: "5H", "30M", "2D", "1W", "1D2H30M", "90S", "1.5H"
# ============================================================
function ConvertFrom-DurationString {
    param([string]$Duration)

    if ([string]::IsNullOrWhiteSpace($Duration)) { return $null }

    $pattern = '(\d+(?:\.\d+)?)\s*([wWdDhHmMsS])'
    $matches = [regex]::Matches($Duration, $pattern)
    if ($matches.Count -eq 0) {
        throw "Invalid duration format: '$Duration'. Expected e.g. '5H', '30M', '2D', '1W', or '1D2H30M'."
    }

    $total = [TimeSpan]::Zero
    foreach ($m in $matches) {
        $value = [double]$m.Groups[1].Value
        switch ($m.Groups[2].Value.ToUpper()) {
            # Accumulate with From*() + Add() so fractional values (e.g. 1.5H)
            # are preserved. The old int-ctor path silently rounded them. (C2)
            'W' { $total = $total.Add([TimeSpan]::FromDays($value * 7)) }
            'D' { $total = $total.Add([TimeSpan]::FromDays($value)) }
            'H' { $total = $total.Add([TimeSpan]::FromHours($value)) }
            'M' { $total = $total.Add([TimeSpan]::FromMinutes($value)) }
            'S' { $total = $total.Add([TimeSpan]::FromSeconds($value)) }
        }
    }
    return $total
}

# ============================================================
# Helper: convert a TimeSpan to ISO 8601 duration (e.g. "PT5H", "PT30M", "P1DT2H")
# Used for scheduled-task repetition intervals and execution limits.
# ============================================================
function ConvertTo-Iso8601Duration {
    param([TimeSpan]$ts)

    $parts = @()
    if ($ts.Days -gt 0)    { $parts += "$($ts.Days)D" }
    if ($ts.Hours -gt 0)   { $parts += "$($ts.Hours)H" }
    if ($ts.Minutes -gt 0) { $parts += "$($ts.Minutes)M" }
    if ($ts.Seconds -gt 0) { $parts += "$($ts.Seconds)S" }

    if ($parts.Count -eq 0) { return "PT0S" }

    $dayPart = ""
    $timePart = ""
    foreach ($p in $parts) {
        if ($p -match '[DH]$' -and -not ($timePart)) {
            if ($p -match 'D$') { $dayPart += $p }
            else { $timePart += $p }
        }
        else { $timePart += $p }
    }

    $result = "P"
    if ($dayPart) { $result += $dayPart }
    if ($timePart) { $result += "T$timePart" }
    return $result
}

# ============================================================
# Helper: manual argument parser supporting --key value and --key=value
# ============================================================
function Parse-Arguments {
    param([string[]]$Arguments)

    $result = @{}
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        $arg = $Arguments[$i]
        if ($arg -match '^--([^=]+)=(.*)$') {
            $result[$matches[1]] = $matches[2]
        }
        elseif ($arg -match '^--(.+)$') {
            $key = $matches[1]
            if (($i + 1) -lt $Arguments.Count -and $Arguments[$i + 1] -notmatch '^--') {
                $result[$key] = $Arguments[$i + 1]
                $i++
            }
            else {
                $result[$key] = $true
            }
        }
    }
    return $result
}

# ============================================================
# Helper: lenient boolean parse (never throws). Used for --dryRun etc.
# Accepts true/1/yes/y/on -> $true; anything else -> $false.
# (Fixes C3: [bool]"false" used to evaluate to $true.)
# ============================================================
function ConvertTo-Bool {
    param($Value)
    if ($null -eq $Value) { return $false }
    if ($Value -is [bool]) { return [bool]$Value }
    switch ("$Value".Trim().ToLower()) {
        'true'  { return $true }
        '1'     { return $true }
        'yes'   { return $true }
        'y'     { return $true }
        'on'    { return $true }
        default { return $false }
    }
}

# ============================================================
# Helper: elevation check (needed to create scheduled tasks)
# ============================================================
function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# Helper: get drive root paths by type
#   DriveType 2 = Removable (USB), 3 = Fixed local disk
# ============================================================
function Get-TargetDrivePaths {
    param([switch]$Removable)

    $filter = if ($Removable) { "DriveType=2" } else { "DriveType=3" }
    $drives = Get-CimInstance -ClassName Win32_LogicalDisk -Filter $filter -ErrorAction SilentlyContinue
    $paths = @()
    foreach ($d in $drives) { $paths += ($d.DeviceID + "\") }
    return $paths
}

# ============================================================
# Helper: wait for removable (USB) volumes to become ready.
# EventID 2003 fires BEFORE the volume is mounted / has a drive letter, so an
# immediate scan often finds nothing. Poll until a ready volume appears or the
# timeout elapses. (H1)
# ============================================================
function Wait-ForUsbDrives {
    param(
        [int]$MaxWaitSeconds = 30,
        [int]$IntervalSeconds = 5
    )

    $elapsed = 0
    while ($elapsed -lt $MaxWaitSeconds) {
        Start-Sleep -Seconds $IntervalSeconds
        $elapsed += $IntervalSeconds

        $candidates = Get-TargetDrivePaths -Removable
        $ready = @()
        foreach ($root in $candidates) {
            if (Test-Path -LiteralPath $root) { $ready += $root }
        }

        if ($ready.Count -gt 0) {
            return $ready
        }
        Write-Log "No ready USB volume yet ($elapsed s elapsed); retrying..." "INFO" "Gray"
    }

    Write-Log "Timed out waiting for a ready USB volume after $MaxWaitSeconds s." "WARNING" "Yellow"
    return @(Get-TargetDrivePaths -Removable)
}

# ============================================================
# Core: scan a set of drives and delete media files
#   -OlderThan : only delete files older than this TimeSpan (optional)
#   -DryRun    : preview only (uses -WhatIf)
# ============================================================
function Invoke-MediaCleanup {
    param(
        [string[]]$DrivePaths,
        [TimeSpan]$OlderThan,
        [switch]$DryRun
    )

    # $OlderThan is a value type ([TimeSpan]); an unset value is [TimeSpan]::Zero,
    # NOT $null, so truthiness ("if ($OlderThan)") can't tell "no filter" apart from
    # an explicit zero duration (e.g. --olderThan 0S). Detect binding instead.
    # NOTE: use the -in OPERATOR over .Keys, NOT $PSBoundParameters.ContainsKey().
    # Under PowerShell ConstrainedLanguage mode (Device Guard / WDAC) method calls
    # on hashtables are blocked and throw "Method invocation is supported only on
    # core types". Operators + property access are allowed. (C1 / C6)
    $hasAgeFilter = 'OlderThan' -in $PSBoundParameters.Keys
    $cutoff = if ($hasAgeFilter) { (Get-Date).Subtract($OlderThan) } else { $null }

    $totalDeleted = 0
    $totalDryRun  = 0
    $totalSkipped = 0

    foreach ($driveRoot in $DrivePaths) {
        Write-Log "Scanning drive $driveRoot ..." "INFO" "Cyan"

        # Get top-level directories, excluding standard OS folders
        $topDirs = Get-ChildItem -Path $driveRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $excludedDirs -notcontains $_.Name }

        # Process each allowed top-level folder recursively
        foreach ($dir in $topDirs) {
            Write-Log "  Scanning $($dir.FullName) ..." "INFO" "Gray"

            # Use -Filter (native filesystem provider) per extension instead of
            # -Include. -Include is unreliable with -Recurse (needs a trailing
            # wildcard path and still misbehaves across PS versions) and under
            # ConstrainedLanguage mode it silently returns nothing. -Filter is
            # fast, honours -Recurse without wildcards, and works everywhere.
            $files = foreach ($ext in $mediaWildcardFilters) {
                Get-ChildItem -Path $dir.FullName -Filter $ext -Recurse -File -ErrorAction SilentlyContinue
            }

            foreach ($file in $files) {
                # Skip if path contains any excluded folder anywhere (extra safety)
                $pathParts = $file.FullName.Split('\')
                if ($pathParts | Where-Object { $excludedDirs -contains $_ }) { continue }

                # Age filter (only delete files older than cutoff)
                if ($hasAgeFilter -and $file.LastWriteTime -gt $cutoff) { continue }

                # FAILSAFE: Double-check the extension strictly before deleting
                $fileExt = $file.Extension.ToLower()
                if ($strictExtensions -notcontains $fileExt) {
                    Write-Log "SKIPPING UNEXPECTED FILE (Not in strict media list): $($file.FullName)" "WARNING" "Yellow"
                    continue
                }

                Write-Log "    Deleting: $($file.FullName)" "INFO" "DarkGray"

                # Counters must reflect reality: only count on success, never on a
                # dry-run preview or on a locked-file failure. (H3 / H4)
                if ($DryRun) {
                    Remove-Item -LiteralPath $file.FullName -Force -WhatIf
                    $totalDryRun++
                }
                else {
                    try {
                        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                        $totalDeleted++
                    }
                    catch {
                        Write-Log "      FAILED to delete (locked/in use?): $($_.Exception.Message)" "WARNING" "Yellow"
                        $totalSkipped++
                    }
                }
            }
        }

        # Also check the root of the drive itself for loose media files.
        # -Filter per extension (see note in the recursive scan above).
        $rootFiles = foreach ($ext in $mediaWildcardFilters) {
            Get-ChildItem -Path $driveRoot -Filter $ext -File -ErrorAction SilentlyContinue
        }

        foreach ($file in $rootFiles) {
            # Age filter
            if ($hasAgeFilter -and $file.LastWriteTime -gt $cutoff) { continue }

            # FAILSAFE: Double-check the extension strictly before deleting
            $fileExt = $file.Extension.ToLower()
            if ($strictExtensions -notcontains $fileExt) {
                Write-Log "SKIPPING UNEXPECTED FILE (Not in strict media list): $($file.FullName)" "WARNING" "Yellow"
                continue
            }

            Write-Log "  Deleting (root): $($file.FullName)" "INFO" "DarkGray"

            if ($DryRun) {
                Remove-Item -LiteralPath $file.FullName -Force -WhatIf
                $totalDryRun++
            }
            else {
                try {
                    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                    $totalDeleted++
                }
                catch {
                    Write-Log "      FAILED to delete (locked/in use?): $($_.Exception.Message)" "WARNING" "Yellow"
                    $totalSkipped++
                }
            }
        }
    }

    if ($DryRun) {
        Write-Log "Dry run complete: would delete $totalDryRun file(s); skipped $totalSkipped." "INFO" "Yellow"
    }
    else {
        Write-Log "Total files deleted: $totalDeleted; failed/skipped: $totalSkipped." "INFO" "Yellow"
    }
}

# ============================================================
# Install: scheduled task that cleans USB drives on insert
# Triggers on EventID 2003 from DriverFrameworks-UserMode/Operational
# ============================================================
function Install-UsbInsertTask {
    Write-Log "Installing USB-insert cleanup scheduled task '$UsbTaskName'..."

    # Enable the event log required for USB arrival detection.
    # wevtutil is a NATIVE EXE: logical failures are non-terminating and do NOT
    # throw, so we must inspect $LASTEXITCODE to know if it actually worked. (C5)
    try {
        & wevtutil sl Microsoft-Windows-DriverFrameworks-UserMode/Operational /e:true
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Enabled DriverFrameworks-UserMode/Operational event log."
        }
        else {
            $msg = "wevtutil failed (exit code $LASTEXITCODE). USB-insert trigger may NOT fire. Enable manually: wevtutil sl Microsoft-Windows-DriverFrameworks-UserMode/Operational /e:true"
            Write-Log $msg "WARNING" "Yellow"
        }
    }
    catch {
        Write-Log "Could not enable event log: $_" "WARNING" "Yellow"
    }

    # Remove existing task of the same name
    Unregister-ScheduledTask -TaskName $UsbTaskName -Confirm:$false -ErrorAction SilentlyContinue

    # Build escaped event subscription (USB device arrival = EventID 2003)
    $rawSub = '<QueryList><Query Id="0" Path="Microsoft-Windows-DriverFrameworks-UserMode/Operational"><Select Path="Microsoft-Windows-DriverFrameworks-UserMode/Operational">*[System[(EventID=2003)]]</Select></Query></QueryList>'
    $escapedSub = $rawSub.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')

    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$escapedSub</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$ScriptPath&quot; --usbClean</Arguments>
    </Exec>
  </Actions>
</Task>
"@

    try {
        Register-ScheduledTask -Xml $xml -TaskName $UsbTaskName -Force | Out-Null
        Write-Log "Scheduled task '$UsbTaskName' created successfully (runs as SYSTEM on USB insert)."
    }
    catch {
        Write-Log "Failed to create scheduled task: $_" "ERROR" "Red"
        exit 1
    }
}

# ============================================================
# Install: daily scheduled task that deletes old local files
# Runs once per day (03:00) deleting files older than $Duration
# ============================================================
function Install-FileAgeCleanupTask {
    param([string]$Duration)

    # Validate the duration before installing
    try {
        $ts = ConvertFrom-DurationString -Duration $Duration
    }
    catch {
        Write-Log "Invalid --fileTimeout value '$Duration': $_" "ERROR" "Red"
        exit 1
    }
    if (-not $ts -or $ts.TotalSeconds -le 0) {
        Write-Log "Invalid --fileTimeout value '$Duration': must be greater than zero." "ERROR" "Red"
        exit 1
    }

    Write-Log "Installing age-cleanup scheduled task '$AgeTaskName' (delete files older than $Duration = $ts)..."

    # Remove existing task of the same name
    Unregister-ScheduledTask -TaskName $AgeTaskName -Confirm:$false -ErrorAction SilentlyContinue

    $startBoundary = (Get-Date).Date.AddHours(3).ToString("yyyy-MM-ddTHH:mm:ss")

    # Repetition interval: for sub-day durations, repeat throughout the day so the
    # effective file age matches the requested timeout. Without this, a daily-only
    # trigger would bound the minimum effective age to ~24h regardless of the value.
    $repetitionXml = ""
    if ($ts.TotalDays -lt 1) {
        # Task Scheduler enforces a 1-minute minimum repetition interval
        $intervalTs = if ($ts.TotalMinutes -lt 1) { [TimeSpan]::FromMinutes(1) } else { $ts }
        $interval = ConvertTo-Iso8601Duration -ts $intervalTs
        $repetitionXml = @"
      <Repetition>
        <Interval>$interval</Interval>
        <Duration>P1D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
"@
        Write-Log "Duration is sub-day; task repeats every $interval (for a daily window) so files are caught promptly."
    }

    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
$repetitionXml      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$ScriptPath&quot; --olderThan $Duration</Arguments>
    </Exec>
  </Actions>
</Task>
"@

    try {
        Register-ScheduledTask -Xml $xml -TaskName $AgeTaskName -Force | Out-Null
        Write-Log "Scheduled task '$AgeTaskName' created successfully (runs as SYSTEM)."
    }
    catch {
        Write-Log "Failed to create scheduled task: $_" "ERROR" "Red"
        exit 1
    }
}

# ============================================================
# Diagnostic: watch USB/device event logs for a window so the correct
# insert EventID can be identified on a given Windows build.
# Run on a TEST box:  delete_media_files.ps1 --usbDiag [seconds]
# then insert a USB device. Review the logged events to pick the Id(s)
# that fire reliably on every insert. (H2)
# ============================================================
function Invoke-UsbInsertDiagnostic {
    param([int]$WatchSeconds = 120)

    Write-Log "===== USB INSERT DIAGNOSTIC =====" "INFO" "Cyan"
    Write-Log "Purpose: identify which EventID fires when a USB device is inserted."
    Write-Log "ACTION: insert a USB device NOW, then wait for the window to close."
    Write-Log "Watching for $WatchSeconds second(s)..."

    # Enable the UMDF log so its events are actually recorded
    try {
        & wevtutil sl Microsoft-Windows-DriverFrameworks-UserMode/Operational /e:true
        Write-Log "UMDF log enable attempt finished; wevtutil exit code = $LASTEXITCODE"
    }
    catch {
        Write-Log "Could not enable UMDF log: $_" "WARNING" "Yellow"
    }

    $start = Get-Date

    # Baseline of removable volumes so we can report newly-arrived ones
    $baseline = @(Get-TargetDrivePaths -Removable)
    Write-Log "Baseline removable volumes: $(if ($baseline.Count) { $baseline -join ', ' } else { '<none>' })"

    $reportedNew = @{}
    $end = $start.AddSeconds($WatchSeconds)
    while ((Get-Date) -lt $end) {
        $now = @(Get-TargetDrivePaths -Removable)
        foreach ($d in $now) {
            if ($baseline -notcontains $d -and -not $reportedNew.ContainsKey($d)) {
                Write-Log ">>> New removable volume detected at $(Get-Date -Format 'HH:mm:ss'): $d" "INFO" "Green"
                $reportedNew[$d] = $true
            }
        }
        Start-Sleep -Seconds 2
    }

    # Candidate logs that typically carry USB/device-arrival events
    $candidateLogs = @(
        'Microsoft-Windows-DriverFrameworks-UserMode/Operational',
        'Microsoft-Windows-DriverFrameworks-UserMode',
        'Microsoft-Windows-Kernel-PnP/Configuration',
        'Microsoft-Windows-Kernel-PnP',
        'Microsoft-Windows-Storage-ClassPnP/Operational',
        'System'
    )

    Write-Log "---- Events recorded between $($start.ToString('HH:mm:ss')) and $(Get-Date -Format 'HH:mm:ss') ----"
    $found = 0
    foreach ($logName in $candidateLogs) {
        $events = $null
        try {
            $events = Get-WinEvent -FilterHashtable @{ LogName = $logName; StartTime = $start } -ErrorAction Stop
        }
        catch {
            # Log does not exist, or no events matched -> skip quietly
            continue
        }

        foreach ($e in $events) {
            # The System log is huge; keep only device/USB/disk-related providers
            if ($logName -eq 'System' -and
                $e.ProviderName -notmatch 'USB|PnP|Device|Disk|partmgr|volmgr|Ntfs|Storage') {
                continue
            }

            $msg = ($e.Message -replace "`r`n", ' ' -replace "`n", ' ').Trim()
            if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + '...' }

            $line = "EVENT  Log={0}  Id={1}  Level={2}  Provider={3}  Time={4}  Msg={5}" -f `
                $logName, $e.Id, $e.LevelDisplayName, $e.ProviderName, $e.TimeCreated.ToString('HH:mm:ss.fff'), $msg
            Write-Log $line "INFO" "Gray"
            $found++
        }
    }

    Write-Log "---- End of events (recorded $found event(s)) ----" "INFO" "Cyan"
    Write-Log "TIP: The Id(s) that appear on EVERY insert are the reliable trigger(s)." "INFO" "Cyan"
    Write-Log "TIP: If none fire reliably, use a WMI __InstanceCreationEvent on Win32_LogicalDisk instead of an event-log trigger." "INFO" "Cyan"
    Write-Log "===== END DIAGNOSTIC =====" "INFO" "Cyan"
}

# ============================================================
# Remove: uninstall all tasks created by this script
# ============================================================
function Remove-ScheduledTasks {
    Write-Log "Removing scheduled tasks (if present)..."
    foreach ($t in @($UsbTaskName, $AgeTaskName)) {
        Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
        Write-Log "Removed task '$t' (if it existed)."
    }
}

# ============================================================
# Main dispatch
# ============================================================
 $params = Parse-Arguments -Arguments $args

# --- Remove mode ---
if ($params.ContainsKey('remove')) {
    if (-not (Test-IsAdmin)) { Write-Log "ERROR: Administrator rights required to remove scheduled tasks." "ERROR" "Red"; exit 1 }
    Remove-ScheduledTasks
    exit 0
}

# --- USB task install/uninstall mode ---
if ($params.ContainsKey('usbTask')) {
    if (-not (Test-IsAdmin)) { Write-Log "ERROR: Administrator rights required to manage scheduled tasks." "ERROR" "Red"; exit 1 }
    # Lenient parse: accept true/false/1/0/yes/no/etc. without throwing. (C4)
    switch -Regex ("$($params['usbTask'])".Trim().ToLower()) {
        '^(true|1|yes|y|on)$'  { Install-UsbInsertTask; break }
        '^(false|0|no|n|off)$' {
            Unregister-ScheduledTask -TaskName $UsbTaskName -Confirm:$false -ErrorAction SilentlyContinue
            Write-Log "Removed task '$UsbTaskName' (if it existed)."
            break
        }
        default {
            Write-Log "Unrecognized --usbTask value '$($params['usbTask'])'. Use true|false. No action taken." "WARNING" "Yellow"
        }
    }
    exit 0
}

# --- File-age task install mode ---
if ($params.ContainsKey('fileTimeout')) {
    if (-not (Test-IsAdmin)) { Write-Log "ERROR: Administrator rights required to manage scheduled tasks." "ERROR" "Red"; exit 1 }
    Install-FileAgeCleanupTask -Duration ([string]$params['fileTimeout'])
    exit 0
}

# --- Execution modes (run by the tasks or manually) ---
 $dryRun = ConvertTo-Bool $params['dryRun']
if ($dryRun) { Write-Log "DRY RUN enabled: no files will actually be deleted." "WARNING" "Yellow" }

 # --- USB insert diagnostic mode (H2) ---
if ($params.ContainsKey('usbDiag')) {
    $watchSeconds = 120
    $diagVal = $params['usbDiag']
    if ($diagVal -isnot [bool]) {
        $parsed = 0
        if ([int]::TryParse("$diagVal", [ref]$parsed) -and $parsed -gt 0) { $watchSeconds = $parsed }
    }
    Invoke-UsbInsertDiagnostic -WatchSeconds $watchSeconds
    exit 0
}

 # USB-only scan (triggered by the USB insert task)
if ($params.ContainsKey('usbClean')) {
    Write-Log "Mode: USB cleanup (removable drives only)."
    # The insert event fires before the volume is mounted; wait for it. (H1)
    Write-Log "Waiting for USB volume(s) to become ready..."
    $drives = Wait-ForUsbDrives
    if ($drives.Count -eq 0) {
        Write-Log "No removable drives found after waiting; nothing to do." "WARNING" "Yellow"
        exit 0
    }
    Write-Log "USB drives to scan: $($drives -join ', ')"
    Invoke-MediaCleanup -DrivePaths $drives -DryRun:$dryRun
    exit 0
}

 # Age-filtered scan on fixed drives (triggered by the age cleanup task)
if ($params.ContainsKey('olderThan')) {
    try {
        $ts = ConvertFrom-DurationString -Duration ([string]$params['olderThan'])
    }
    catch {
        Write-Log "Invalid --olderThan value: $_" "ERROR" "Red"
        exit 1
    }
    # Reject zero/non-positive on the direct path too (parity with the install
    # path), so --olderThan 0S can't silently mean "delete everything". (C1)
    if (-not $ts -or $ts.TotalSeconds -le 0) {
        Write-Log "Invalid --olderThan value '$($params['olderThan'])': must be greater than zero." "ERROR" "Red"
        exit 1
    }
    Write-Log "Mode: age cleanup (fixed drives, files older than $ts)."
    $drives = Get-TargetDrivePaths
    Invoke-MediaCleanup -DrivePaths $drives -OlderThan $ts -DryRun:$dryRun
    exit 0
}

 # Default: scan all fixed drives, delete all media
Write-Log "Mode: full cleanup (all fixed drives)."
 $drives = Get-TargetDrivePaths
Invoke-MediaCleanup -DrivePaths $drives -DryRun:$dryRun
exit 0
