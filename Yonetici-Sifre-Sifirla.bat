@echo off
rem Ana yonetici kullanici adi ve parolasini uygulama DISINDAN sifirlar.
rem Once uygulamayi kapatın (Baslat.bat penceresi veya exe).

title Yonetici sifre sifirlama
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js bulunamadi. https://nodejs.org adresinden kurun.
  echo.
  pause
  exit /b 1
)

echo.
echo  Uygulama kapali olmali. Devam etmek icin bir tusa basin...
pause >nul

node server\reset-admin.mjs %*

echo.
pause
