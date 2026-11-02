@echo off
setlocal
title Macuxi FDV - configurar dominio fixo da demo (uma vez so)
cd /d "%~dp0.."

set "CF=cloudflared"
where cloudflared >nul 2>nul || set "CF=%CD%\.dados\demo\bin\cloudflared.exe"

echo.
echo ==^> 1/2 Autorizacao da Cloudflare
if exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo     Ja autorizado neste computador. Pulando o login.
) else (
  echo     Vai abrir o navegador: escolha macuxifdv.com.br e clique em Authorize.
  "%CF%" tunnel login
  if errorlevel 1 (
    echo.
    echo ERRO: o login da Cloudflare nao terminou. Rode este atalho de novo.
    pause
    exit /b 1
  )
)

echo.
echo ==^> 2/2 Criando o tunel macuxi-demo e os enderecos api-demo e bko-demo
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\demo\configurar-dominio.ps1" %*
if errorlevel 1 (
  echo.
  echo ERRO na configuracao. Copie a mensagem acima e mande para o Claude.
  pause
  exit /b 1
)

echo.
echo Pronto. Daqui em diante, so _instalar\subir-demo.cmd
echo    App: https://api-demo.macuxifdv.com.br/v1
echo    BKO: https://bko-demo.macuxifdv.com.br
pause
