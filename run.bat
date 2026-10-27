@echo off
rem One-click launcher for Windows: checks the prerequisites, installs what's missing, starts musi-type.
rem Extra options pass through, e.g.  run.bat --audio   (also installs faster-whisper)
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org
  echo or run:  winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
node scripts\start.mjs %*
if errorlevel 1 pause
