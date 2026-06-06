# ============================================================
# DANGER: DELETES FILES PERMANENTLY
# -WhatIf is enabled by default so you can preview changes.
# Remove -WhatIf ONLY when you are absolutely sure.
# ============================================================

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
    "$Recycle.Bin",
    "System Volume Information",
    "Recovery",
    "PerfLogs"
)

# Get all local fixed drives
 $localDrives = Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Root -match "^[C-Z]:\\$" }

 $totalDeleted = 0

foreach ($drive in $localDrives) {
    $rootPath = $drive.Root
    Write-Host "`nScanning drive $rootPath ..." -ForegroundColor Cyan

    # Get top-level directories, excluding standard OS folders
    $topDirs = Get-ChildItem -Path $rootPath -Directory -ErrorAction SilentlyContinue |
        Where-Object { $excludedDirs -notcontains $_.Name }

    # Process each allowed top-level folder recursively
    foreach ($dir in $topDirs) {
        Write-Host "  Scanning $($dir.FullName) ..." -ForegroundColor Gray

        $files = Get-ChildItem -Path $dir.FullName -Recurse -File -Include $mediaWildcardFilters -ErrorAction SilentlyContinue

        foreach ($file in $files) {
            # Skip if path contains any excluded folder anywhere (extra safety)
            $pathParts = $file.FullName.Split('\')
            if ($pathParts | Where-Object { $excludedDirs -contains $_ }) {
                continue
            }

            # FAILSAFE: Double-check the extension strictly before deleting
            $fileExt = $file.Extension.ToLower()
            if ($strictExtensions -notcontains $fileExt) {
                Write-Warning "SKIPPING UNEXPECTED FILE (Not in strict media list): $($file.FullName)"
                continue
            }

            Write-Host "    Deleting: $($file.FullName)" -ForegroundColor DarkGray

            # USING -LiteralPath PREVENTS BRACKETS [] FROM CAUSING ERRORS
            # REMOVE -WhatIf AFTER YOU HAVE VERIFIED THE OUTPUT!
            Remove-Item -LiteralPath $file.FullName -Force -WhatIf
            $totalDeleted++
        }
    }

    # Also check the root of the drive itself for loose media files
    $rootFiles = Get-ChildItem -Path "$rootPath*" -File -Include $mediaWildcardFilters -ErrorAction SilentlyContinue

    foreach ($file in $rootFiles) {
        # FAILSAFE: Double-check the extension strictly before deleting
        $fileExt = $file.Extension.ToLower()
        if ($strictExtensions -notcontains $fileExt) {
            Write-Warning "SKIPPING UNEXPECTED FILE (Not in strict media list): $($file.FullName)"
            continue
        }

        Write-Host "  Deleting (root): $($file.FullName)" -ForegroundColor DarkGray

        # USING -LiteralPath PREVENTS BRACKETS [] FROM CAUSING ERRORS
        # REMOVE -WhatIf AFTER YOU HAVE VERIFIED THE OUTPUT!
        Remove-Item -LiteralPath $file.FullName -Force -WhatIf
        $totalDeleted++
    }
}

Write-Host "`nTotal files deleted: $totalDeleted" -ForegroundColor Yellow
