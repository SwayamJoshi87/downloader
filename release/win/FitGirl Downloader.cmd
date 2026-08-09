@echo off
setlocal
cd /d "%~dp0app"
"%~dp0runtime\node.exe" "server\index.js"
if errorlevel 1 pause
