@echo off
chcp 65001 >nul
title Macuxi FDV - derrubar demonstracao
cd /d "%~dp0.." || (echo [ERRO] Pasta do projeto nao encontrada. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\demo\derrubar-demo.ps1" %*
pause
