@echo off
rem FLO-RENT - start the server without going through npm.ps1
rem (PowerShell blocks npm.ps1 when the ExecutionPolicy is Restricted)
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [FLO-RENT] Node.js not found in PATH.
  echo Install Node.js 18+ from https://nodejs.org and try again.
  pause
  exit /b 1
)

echo [FLO-RENT] starting server on http://127.0.0.1:4173
echo [FLO-RENT] press Ctrl+C to stop
node server\server.js

echo.
echo [FLO-RENT] server stopped.
pause
