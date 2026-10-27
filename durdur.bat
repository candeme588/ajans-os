@echo off
chcp 65001 >nul
title AJANS OS - Durdur
echo.
echo  AJANS OS durduruluyor...
echo.

set BULUNDU=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7777" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>nul
  set BULUNDU=1
)

if "%BULUNDU%"=="1" (
  echo  Sunucu durduruldu.
) else (
  echo  Calisan sunucu bulunamadi.
)

echo.
timeout /t 2 >nul
