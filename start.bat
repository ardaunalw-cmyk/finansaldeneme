@echo off
title ONCE & ALWAYS - Sovereign Financial Terminal
cd /d "%~dp0" 2>nul

echo ========================================================
echo   ONCE & ALWAYS - Finansal Zeka Platformu Baslatiliyor...
echo ========================================================
echo.

rem Node is installed per-user via winget; make sure this window can find it
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul ^| find "Path"') do set "PATH=%PATH%;%%B"

if not exist node_modules (
  echo Bagimliliklar kuruluyor...
  call npm install --no-audit --no-fund
)

start "" http://localhost:8080/
call npm run dev

pause
