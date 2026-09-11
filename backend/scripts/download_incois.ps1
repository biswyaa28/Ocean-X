# OceanLens - INCOIS HYCOM Downloader
# Resumable download for large NetCDF files

$ErrorActionPreference = "Stop"

# This script is inside:
# O:\Hackthons\OceanLens\backend\scripts
#
# Therefore:
# $PSScriptRoot = ...\backend\scripts
# $root         = ...\backend

$root = Split-Path -Parent $PSScriptRoot

# Correct destination:
# ...\backend\data\raw\ocean\currents
$outDir = Join-Path $root "data\raw\ocean\currents"

# Create destination folder if it does not exist
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# INCOIS HYCOM file
$url = "https://incois.gov.in/thredds/fileServer/osf/currents2/RSMC_hycom_20260908.nc"

# Local output file
$output = Join-Path $outDir "RSMC_hycom_20260908.nc"

Write-Host ""
Write-Host "=============================================="
Write-Host " OceanLens - INCOIS HYCOM Downloader"
Write-Host "=============================================="
Write-Host ""
Write-Host "Source:"
Write-Host $url
Write-Host ""
Write-Host "Output:"
Write-Host $output
Write-Host ""

# Check whether a partial file already exists
if (Test-Path $output) {
    $sizeGB = (Get-Item $output).Length / 1GB

    Write-Host "Existing file found."
    Write-Host ("Current size: {0:N2} GB" -f $sizeGB)
    Write-Host "Attempting to RESUME download..."
    Write-Host ""
}
else {
    Write-Host "No existing file found."
    Write-Host "Starting new download..."
    Write-Host ""
}

# Download with resume support
curl.exe `
    -L `
    --fail `
    --retry 20 `
    --retry-delay 10 `
    --retry-max-time 0 `
    -C - `
    -o "$output" `
    "$url"

# Check result
if ($LASTEXITCODE -eq 0) {

    Write-Host ""
    Write-Host "=============================================="
    Write-Host " DOWNLOAD COMPLETE"
    Write-Host "=============================================="
    Write-Host ""

    if (Test-Path $output) {
        $sizeGB = (Get-Item $output).Length / 1GB

        Write-Host "File:"
        Write-Host $output
        Write-Host ""
        Write-Host ("Final size: {0:N2} GB" -f $sizeGB)
    }

    Write-Host ""
}
else {

    Write-Host ""
    Write-Host "=============================================="
    Write-Host " DOWNLOAD STOPPED / FAILED"
    Write-Host "=============================================="
    Write-Host ""
    Write-Host "The partial file has been preserved."
    Write-Host "Run this same script again to resume."
    Write-Host ""
}