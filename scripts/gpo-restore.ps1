<#
.SYNOPSIS
    Downloads a zip file from a URL, extracts Group Policy and PolicyDefinitions,
    and replaces them on the target PC.
    Designed to run under the SYSTEM account via FOG Service.
#>

# --- Configuration ---
# URL to the hosted zip file (HTTPS is highly recommended)
 $DownloadUrl = "https://your-domain.com/path/to/GPO_Backup.zip"

# Local path where the zip will be temporarily saved
 $ZipFilePath = "$env:Temp\FogGpoRestore.zip"

# Target directories
 $GroupPolicyTarget = "$env:SystemRoot\System32\GroupPolicy"
 $PolicyDefsTarget = "$env:SystemRoot\PolicyDefinitions"

# Temporary extraction directory
 $TempExtractPath = "$env:Temp\FOG_GPO_Restore"

# --- Force TLS 1.2 ---
# The SYSTEM account often defaults to TLS 1.0/1.1, which modern web servers reject.
# This forces the connection to use TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Download the Zip File ---
Write-Output "Downloading GPO backup from $DownloadUrl..."
try {
    # Download the file. Using -OutFile automatically handles saving the stream correctly.
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipFilePath -UseBasicParsing
    Write-Output "Download complete. Saved to $ZipFilePath"
}
catch {
    Write-Error "CRITICAL: Failed to download zip file. Details: $_"
    exit 1
}

# Verify the file actually downloaded and isn't empty (e.g., 404 error page saved as a zip)
 $fileSize = (Get-Item $ZipFilePath).Length
if ($fileSize -lt 1000) {
    Write-Error "CRITICAL: Downloaded file is suspiciously small ($fileSize bytes). The URL might be incorrect or returning an error page."
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
Write-Output "Extracting zip file to temp directory..."
try {
    Expand-Archive -Path $ZipFilePath -DestinationPath $TempExtractPath -Force
}
catch {
    Write-Error "Failed to extract zip file. It may be corrupted. Details: $_"
    exit 1
}

# --- Kill Conflicting Processes ---
# gpedit.msc and rsop.msc lock policy files. Force close them before overwriting.
Write-Output "Checking for and closing Group Policy console windows..."
 $processesToKill = @("mmc", "rsop")
foreach ($proc in $processesToKill) {
    Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# --- Copy GroupPolicy ---
# Look for the GroupPolicy folder inside the extracted content
 $SourceGroupPolicy = Get-ChildItem -Path $TempExtractPath -Recurse -Directory -Filter "GroupPolicy" | Select-Object -First 1

if ($SourceGroupPolicy) {
    Write-Output "Replacing contents of $GroupPolicyTarget..."
    try {
        # Copy contents (using \* at the end of source path to copy CONTENTS, not the parent folder)
        Copy-Item -Path "$($SourceGroupPolicy.FullName)\*" -Destination $GroupPolicyTarget -Recurse -Force -ErrorAction Stop
        Write-Output "GroupPolicy replaced successfully."
    }
    catch {
        Write-Error "Failed to copy GroupPolicy. A file may be locked by the system. Details: $_"
    }
}
else {
    Write-Warning "Could not find a 'GroupPolicy' folder inside the zip file. Skipping."
}

# --- Copy PolicyDefinitions ---
# Look for the PolicyDefinitions folder inside the extracted content
 $SourcePolicyDefs = Get-ChildItem -Path $TempExtractPath -Recurse -Directory -Filter "PolicyDefinitions" | Select-Object -First 1

if ($SourcePolicyDefs) {
    Write-Output "Replacing contents of $PolicyDefsTarget..."
    try {
        # Copy contents
        Copy-Item -Path "$($SourcePolicyDefs.FullName)\*" -Destination $PolicyDefsTarget -Recurse -Force -ErrorAction Stop
        Write-Output "PolicyDefinitions replaced successfully."
    }
    catch {
        Write-Error "Failed to copy PolicyDefinitions. Details: $_"
    }
}
else {
    Write-Warning "Could not find a 'PolicyDefinitions' folder inside the zip file. Skipping."
}

# --- Cleanup ---
Write-Output "Cleaning up temp files..."
Remove-Item -Path $TempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $ZipFilePath -Force -ErrorAction SilentlyContinue

# --- Force Policy Update (Optional) ---
# If you want the computer to immediately apply the new policies without a reboot,
# uncomment the line below. Warning: This adds 1-2 minutes to the script runtime.
# gpupdate /force

Write-Output "GPO Restore script completed."
exit 0
