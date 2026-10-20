@echo off
title ONCE & ALWAYS - Sovereign Financial Terminal
cd /d "%~dp0" 2>nul

echo ========================================================
echo   ONCE & ALWAYS - Finansal Zeka Platformu Baslatiliyor...
echo ========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress; if (-not $ip) { $ip = '127.0.0.1' }; Write-Host '  * Bilgisayarda Baglanti: http://localhost:8080/' -ForegroundColor Green; Write-Host ('  * Telefondan Baglanti:   http://' + $ip + ':8080/') -ForegroundColor Yellow; Start-Process 'http://localhost:8080/'; & '.\server.ps1'"

pause
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress; if (-not $ip) { $ip = '127.0.0.1' }; Write-Host '  * Bilgisayarda Baglanti: http://localhost:8080/' -ForegroundColor Green; Write-Host ('  * Telefondan Baglanti:   http://' + $ip + ':8080/') -ForegroundColor Yellow; Start-Process 'http://localhost:8080/'; & '.\server.ps1'"

pause

