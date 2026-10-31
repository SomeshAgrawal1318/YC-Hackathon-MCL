@echo off
setlocal
cd /d "%~dp0"
title MonteCarlo Labs demo
echo MonteCarlo Labs demo
echo.
where npm >nul 2>nul
if errorlevel 1 (
  echo node-missing> setup-status.txt
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo Installing dependencies. The first time takes a few minutes...
  echo installing> setup-status.txt
  call npm install > setup.log 2>&1
  if errorlevel 1 (
    echo install-failed> setup-status.txt
    echo npm install failed. See setup.log in this folder.
    pause
    exit /b 1
  )
)
if not exist native\trace-helper\target\release\trace-helper.exe (
  where cargo >nul 2>nul
  if not errorlevel 1 (
    echo Building the Trace helper. The first time takes a few minutes...
    call npm run helper:build > helper-build.log 2>&1
    if errorlevel 1 echo The Trace helper did not build. See helper-build.log. Trace will use in-app capture.
  )
)
echo Starting Odoo in WSL...
call npm run odoo:start > odoo.log 2>&1
if errorlevel 1 echo Odoo did not start. See odoo.log. Recording still works; test runs need Odoo.
echo Starting the Durable Actors server in WSL (shadow mode, approvals)...
call npm run actors:dev > actors.log 2>&1
if errorlevel 1 echo The actors server did not start. See actors.log. Shadow mode will show the simulated preview.
echo Checking types...
call npm run typecheck > typecheck.log 2>&1
echo Building...
call npm run build > build.log 2>&1
if errorlevel 1 (
  echo build-failed> setup-status.txt
  echo The build failed. See build.log in this folder.
  pause
  exit /b 1
)
echo running> setup-status.txt
echo.
echo Starting the demo. Trace is in the taskbar tray, behind the ^^ arrow.
echo Close this window to stop the demo.
call npx electron .
