@echo off
chcp 65001 >nul
title AJANS OS - Sunucuya Kur
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sunucuya-kur.ps1"
