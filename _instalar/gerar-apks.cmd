@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Macuxi FDV - gerar APKs (EAS)

rem ============================================================
rem  Gera os APKs do Macuxi Campo e do Macuxi Gestao no EAS.
rem  Uso: clique duas vezes neste arquivo (C:\macuxifdv\_instalar\gerar-apks.cmd).
rem  Passo a passo manual: docs\status\eas-build-passo-a-passo.md
rem ============================================================

cd /d "%~dp0..\apps\mobile" || (echo [ERRO] Pasta apps\mobile nao encontrada. & pause & exit /b 1)

where node >nul 2>&1 || (echo [ERRO] Node nao encontrado. Instale o Node 24 LTS e tente de novo. & pause & exit /b 1)
where pnpm >nul 2>&1 || (echo [ERRO] pnpm nao encontrado. Rode: corepack enable & pause & exit /b 1)

set "EAS=npx --yes eas-cli@latest"

echo.
echo === 1/3  Conferindo a conta Expo ===
call %EAS% whoami >nul 2>&1
if errorlevel 1 (
  echo Voce ainda nao esta logado na Expo. Vai abrir o login:
  call %EAS% login
)
call %EAS% whoami
if errorlevel 1 (
  echo [ERRO] Login na Expo nao concluido. Rode o arquivo de novo.
  pause & exit /b 1
)

:menu
echo.
echo === 2/3  O que voce quer gerar? ===
echo   1 - APKs de DESENVOLVIMENTO (Campo + Gestao)  ^<- fecha a T-0004 / Sprint 0
echo   2 - APKs de DEMONSTRACAO / preview (Campo + Gestao), funcionam sem o PC
echo   3 - So o Campo de desenvolvimento
echo   4 - So o Campo de demonstracao (preview)
echo   5 - Servir o JavaScript para os APKs de desenvolvimento (PC e celular na mesma rede)
echo   0 - Sair
set "OP="
set /p "OP=Digite o numero e Enter: "

if "%OP%"=="1" (call :build campo & call :build gestao & goto fim)
if "%OP%"=="2" (call :build campo-preview & call :build gestao-preview & goto fim)
if "%OP%"=="3" (call :build campo & goto fim)
if "%OP%"=="4" (call :build campo-preview & goto fim)
if "%OP%"=="5" goto servir
if "%OP%"=="0" exit /b 0
echo Opcao invalida.
goto menu

:build
echo.
rem --- Antes de gastar build da Expo: arvore limpa e bundle do Metro verde ---
set "SUJO="
for /f "delims=" %%L in ('git status --porcelain 2^>nul') do set "SUJO=1"
if not defined SUJO goto build_bundle
echo [AVISO] Ha arquivos alterados sem commit no repositorio - o EAS envia a arvore como esta.
echo         Se os agentes estao rodando, espere o fechamento da rodada (commit + push).
set "CONT="
set /p "CONT=Continuar mesmo assim? (S/N): "
if /i not "%CONT%"=="S" exit /b 0
:build_bundle
set "VAR=campo"
echo %~1| find /i "gestao" >nul && set "VAR=gestao"
echo --- Conferindo o bundle do app (Metro) para a variante %VAR% ---
set "APP_VARIANT=%VAR%"
call pnpm --filter mobile bundle:android
if errorlevel 1 goto build_erro_bundle
echo.
echo --- Enviando o build "%~1" para a fila da Expo ---
echo (Na primeira vez a Expo pergunta se pode criar a chave de assinatura do Android: responda Y / Enter.)
call %EAS% build --profile %~1 --platform android --no-wait
if errorlevel 1 (
  echo [ERRO] O build "%~1" nao foi enviado. Veja a mensagem acima.
  pause
)
exit /b 0

:build_erro_bundle
echo [ERRO] O bundle do app quebrou: o build da Expo falharia do mesmo jeito. Avise o engenheiro.
pause
exit /b 0

:servir
echo.
echo === Servindo o JavaScript (deixe esta janela aberta enquanto usa os APKs de desenvolvimento) ===
call pnpm exec expo start --dev-client
goto fim

:fim
echo.
echo === 3/3  Pronto ===
echo Os builds rodam na nuvem da Expo (cerca de 15 a 25 min cada).
echo Vou abrir a pagina dos builds: quando ficarem verdes, abra o link no celular,
echo baixe o APK e permita "instalar de fontes desconhecidas".
start "" "https://expo.dev/accounts/macuxifdv/projects/macuxi-fdv/builds"
echo.
echo Depois avise o gerente no VS Code com os links dos builds de desenvolvimento.
pause
exit /b 0
