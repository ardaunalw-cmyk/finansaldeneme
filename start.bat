@echo off
title UTL FINANS - Sovereign Intelligence & KAP Terminal
echo ===================================================
echo   UTL FINANS - Sovereign Intelligence & KAP Terminal
echo ===================================================
echo Yerel KAP Veri Sunucusu baslatiliyor...
start "" powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0server.ps1"
timeout /t 2 /nobreak >nul
echo Tarayicinizda aciliyor (http://localhost:8080)...
start http://localhost:8080/
echo.
echo Tamamlandi!
