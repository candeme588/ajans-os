@echo off
chcp 65001 >nul
title AJANS OS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js bulunamadi.
  echo  https://nodejs.org adresinden LTS surumu kurup tekrar dene.
  echo.
  pause
  exit /b 1
)

echo.
echo  ===============================================
echo    AJANS OS
echo  ===============================================
echo.

rem --- zaten calisiyor mu ---
netstat -ano | findstr ":7777" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo  Sunucu zaten calisiyor.
  echo  Tarayici aciliyor: http://localhost:7777
  start "" http://localhost:7777
  timeout /t 3 >nul
  exit /b 0
)

echo  Bir tarayici penceresi 3 saniye icinde acilacak.
echo  Bu pencereyi KAPATMAYIN - sunucu bunun icinde calisiyor.
echo.

start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:7777"

:loop
node server.js
set KOD=%errorlevel%

if "%KOD%"=="0" goto son

echo.
echo  Sunucu kapandi (kod %KOD%). 5 saniye icinde yeniden denenecek.
echo  Cikmak icin Ctrl+C.
timeout /t 5 >nul
goto loop

:son
echo.
echo  Sunucu durduruldu.
pause
