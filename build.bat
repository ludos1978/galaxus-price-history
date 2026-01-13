@echo off
REM Build script for Galaxus Price Analyzer - Windows batch wrapper
REM This calls the PowerShell script

echo Running build script...
powershell -ExecutionPolicy Bypass -File "%~dp0build.ps1"
pause
