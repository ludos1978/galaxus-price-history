# Build script for Galaxus Price Analyzer
# Windows PowerShell version

$ErrorActionPreference = "Stop"

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $ScriptDir "dist"
$ExtDir = Join-Path $ScriptDir "extension"

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Galaxus Price Analyzer - Build Tool  " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Create dist directory
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

# Get version from manifest.json
$ManifestPath = Join-Path $ExtDir "manifest.json"
$Manifest = Get-Content $ManifestPath | ConvertFrom-Json
$Version = $Manifest.version
Write-Host "Building version: $Version" -ForegroundColor Yellow
Write-Host ""

# Build Chrome extension (zip)
Write-Host "Building Chrome extension..." -ForegroundColor Cyan
$ChromeZip = Join-Path $BuildDir "galaxus-price-analyzer-chrome-v$Version.zip"
if (Test-Path $ChromeZip) { Remove-Item $ChromeZip }
Compress-Archive -Path "$ExtDir\*" -DestinationPath $ChromeZip -Force
Write-Host "   Created: dist\galaxus-price-analyzer-chrome-v$Version.zip" -ForegroundColor Green

# Build Firefox extension (zip)
Write-Host "Building Firefox extension..." -ForegroundColor Cyan
$FirefoxZip = Join-Path $BuildDir "galaxus-price-analyzer-firefox-v$Version.zip"
if (Test-Path $FirefoxZip) { Remove-Item $FirefoxZip }
Compress-Archive -Path "$ExtDir\*" -DestinationPath $FirefoxZip -Force
Write-Host "   Created: dist\galaxus-price-analyzer-firefox-v$Version.zip" -ForegroundColor Green

# Copy userscript to dist
Write-Host "Copying userscript..." -ForegroundColor Cyan
$UserscriptSrc = Join-Path $ScriptDir "galaxus-price-analyzer.user.js"
$UserscriptDst = Join-Path $BuildDir "galaxus-price-analyzer.user.js"
Copy-Item $UserscriptSrc $UserscriptDst -Force
Write-Host "   Copied: dist\galaxus-price-analyzer.user.js" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Build complete!                      " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output files in dist\:"
Get-ChildItem $BuildDir | Format-Table Name, Length, LastWriteTime
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  Chrome Web Store: Upload dist\galaxus-price-analyzer-chrome-v$Version.zip"
Write-Host "  Firefox Add-ons:  Upload dist\galaxus-price-analyzer-firefox-v$Version.zip"
Write-Host "  GreasyFork:       Upload dist\galaxus-price-analyzer.user.js"
