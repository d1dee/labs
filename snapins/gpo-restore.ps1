<#
.SYNOPSIS
    Downloads a zip file from a URL, extracts Group Policy and PolicyDefinitions,
    and replaces them on the target PC.
    Designed to run under the SYSTEM account via FOG Service.
.NOTES
    All output is logged to a timestamped log file in %TEMP%
#>

param(
    [string]$LogFilePath
)

# --- Configuration ---
# URL to the hosted zip file (HTTPS is highly recommended)
 $DownloadUrl = "http://192.168.1.21/iso/GPO-policies/GPO_Backup.zip"

# Local path where the zip will be temporarily saved
 $ZipFilePath = "$env:Temp\FogGpoRestore.zip"

# Target directories
 $GroupPolicyTarget = "$env:SystemRoot\System32\GroupPolicy"
 $PolicyDefsTarget = "$env:SystemRoot\PolicyDefinitions"

# Temporary extraction directory
 $TempExtractPath = "$env:Temp\FOG_GPO_Restore"

# Log file path (use passed value when re-launched as 64-bit to keep one log)
if (-not $LogFilePath) {
    $LogFilePath = "C:\snapin\GPO_Restore_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
}

# Logging function
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFilePath -Value $logEntry
}

# --- Ensure 64-bit PowerShell (avoid WOW64 file system redirection) ---
# The FOG client is 32-bit and may launch this script under 32-bit PowerShell.
# Under WOW64, $env:SystemRoot\System32 is redirected to SysWOW64, so copies
# targeting System32\GroupPolicy land in the wrong folder (or appear to fail).
# Re-launch as 64-bit so System32 resolves to the real directory.
if ($env:PROCESSOR_ARCHITEW6432 -and -not [Environment]::Is64BitProcess) {
    Write-Log "Detected 32-bit PowerShell on 64-bit OS (WOW64). Re-launching as 64-bit to access real System32..."
    $sysNative = Join-Path $env:WinDir "Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    if (Test-Path $sysNative) {
        & $sysNative -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -LogFilePath $LogFilePath
        exit $LASTEXITCODE
    }
    Write-Log "Could not locate 64-bit PowerShell via Sysnative. Continuing in 32-bit (copies may be redirected)." "WARNING"
}

# --- Force TLS 1.2 ---
# The SYSTEM account often defaults to TLS 1.0/1.1, which modern web servers reject.
# This forces the connection to use TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Download the Zip File ---
Write-Log "Downloading GPO backup from $DownloadUrl..."
try {
    # Download the file. Using -OutFile automatically handles saving the stream correctly.
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipFilePath -UseBasicParsing
    Write-Log "Download complete. Saved to $ZipFilePath"
}
catch {
    Write-Log "CRITICAL: Failed to download zip file. Details: $_" "ERROR"
    exit 1
}

# Verify the file actually downloaded and isn't empty (e.g., 404 error page saved as a zip)
 $fileSize = (Get-Item $ZipFilePath).Length
if ($fileSize -lt 1000) {
    Write-Log "CRITICAL: Downloaded file is suspiciously small ($fileSize bytes). The URL might be incorrect or returning an error page." "ERROR"
    Remove-Item -Path $ZipFilePath -Force -ErrorAction SilentlyContinue
    exit 1
}

# --- Preparation ---
# Ensure target directories exist (creates them if they don't, preventing copy errors)
if (-not (Test-Path -Path $GroupPolicyTarget)) { New-Item -Path $GroupPolicyTarget -ItemType Directory -Force | Out-Null }
if (-not (Test-Path -Path $PolicyDefsTarget)) { New-Item -Path $PolicyDefsTarget -ItemType Directory -Force | Out-Null }

# Create/Clean the temp extraction folder
if (Test-Path -Path $TempExtractPath) { Remove-Item -Path $TempExtractPath -Recurse -Force }
New-Item -Path $TempExtractPath -ItemType Directory -Force | Out-Null

# --- Extraction ---
Write-Log "Extracting zip file to temp directory..."
try {
    Expand-Archive -Path $ZipFilePath -DestinationPath $TempExtractPath -Force
}
catch {
    Write-Log "Failed to extract zip file. It may be corrupted. Details: $_" "ERROR"
    exit 1
}

# --- Test Permissions Before Copy ---
Write-Log "Verifying write permissions to System32..."
$testFile = "$env:SystemRoot\System32\GPO_Restore_Test_$(Get-Date -Format 'yyyyMMdd_HHmmss').tmp"
try {
    "TEST" | Out-File -FilePath $testFile -Force -ErrorAction Stop
    Remove-Item -Path $testFile -Force -ErrorAction Stop
    Write-Log "Write permissions to System32 verified. Running as SYSTEM account."
}
catch {
    Write-Log "CRITICAL: Cannot write to System32. Script must run as SYSTEM account. Details: $_" "ERROR"
    Write-Log "Current user: $env:USERNAME" "ERROR"
    exit 1
}

# --- Kill Conflicting Processes ---
# gpedit.msc and rsop.msc lock policy files. Force close them before overwriting.
Write-Log "Checking for and closing Group Policy console windows..."
 $processesToKill = @("mmc", "rsop")
foreach ($proc in $processesToKill) {
    Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# --- Copy GroupPolicy ---
# Look for the GroupPolicy folder inside the extracted content
 $SourceGroupPolicy = Get-ChildItem -Path $TempExtractPath -Recurse -Directory -Filter "GroupPolicy" | Select-Object -First 1

if ($SourceGroupPolicy) {
    Write-Log "Replacing contents of $GroupPolicyTarget..."
    try {
        # Copy contents (using \* at the end of source path to copy CONTENTS, not the parent folder)
        Copy-Item -Path "$($SourceGroupPolicy.FullName)\*" -Destination $GroupPolicyTarget -Recurse -Force -ErrorAction Stop
        Write-Log "GroupPolicy replaced successfully."
    }
    catch {
        Write-Log "Failed to copy GroupPolicy. A file may be locked by the system. Details: $_" "ERROR"
    }
}
else {
    Write-Log "Could not find a 'GroupPolicy' folder inside the zip file. Skipping." "WARNING"
}

# --- Copy PolicyDefinitions ---
# Look for the PolicyDefinitions folder inside the extracted content
 $SourcePolicyDefs = Get-ChildItem -Path $TempExtractPath -Recurse -Directory -Filter "PolicyDefinitions" | Select-Object -First 1

if ($SourcePolicyDefs) {
    Write-Log "Replacing contents of $PolicyDefsTarget..."
    try {
        # Copy contents
        Copy-Item -Path "$($SourcePolicyDefs.FullName)\*" -Destination $PolicyDefsTarget -Recurse -Force -ErrorAction Stop
        Write-Log "PolicyDefinitions replaced successfully."
    }
    catch {
        Write-Log "Failed to copy PolicyDefinitions. Details: $_" "ERROR"
    }
}
else {
    Write-Log "Could not find a 'PolicyDefinitions' folder inside the zip file. Skipping." "WARNING"
}

# --- Cleanup ---
Write-Log "Cleaning up temp files..."
#Remove-Item -Path $TempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
#Remove-Item -Path $ZipFilePath -Force -ErrorAction SilentlyContinue

# --- Force Policy Update (Optional) ---
# If you want the computer to immediately apply the new policies without a reboot,
# uncomment the line below. Warning: This adds 1-2 minutes to the script runtime.
# gpupdate /force

Write-Log "GPO Restore script completed."
exit 0
