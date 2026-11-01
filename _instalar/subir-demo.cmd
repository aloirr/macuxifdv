@echo off
chcp 65001 >nul
title Macuxi FDV - subir demonstracao
rem Sobe a demonstracao (Docker, banco com a base de demo, API, worker e tunel HTTPS).
rem Detalhes: scripts\demo\LEIA-ME.md
cd /d "%~dp0.." || (echo [ERRO] Pasta do projeto nao encontrada. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\demo\subir-demo.ps1" %*
echo.
echo Deixe esta janela aberta enquanto a demonstracao estiver rodando.
echo Para encerrar: clique duas vezes em _instalar\derrubar-demo.cmd
pause
