@echo off
setlocal
title PracticePlan
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo PracticePlan needs Node.js 24 or newer. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies. This takes a minute...
  call npm install
  if errorlevel 1 goto :failed
)

if not exist "dist\index.html" (
  echo Building the app...
  call npm run build
  if errorlevel 1 goto :failed
)

if "%PORT%"=="" set PORT=4780
echo.
echo PracticePlan is starting at http://localhost:%PORT%
echo Keep this window open while you use the app. Close it to stop PracticePlan.
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"
node --disable-warning=ExperimentalWarning server/index.js
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Something went wrong. The message above says what.
pause
exit /b 1
