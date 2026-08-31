@echo off
title Axthrowa sertifikasini kur
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "Sertifikayi-Kur.ps1"
pause
