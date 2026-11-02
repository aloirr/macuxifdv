@echo off
setlocal EnableDelayedExpansion
title Macuxi FDV - merges pendentes
cd /d "%~dp0.."
if not exist "_instalar\merge-pendente.txt" (
  echo Nenhum merge pendente em _instalar\merge-pendente.txt
  pause
  exit /b 0
)
for /f "usebackq tokens=1-4 delims=|" %%a in ("_instalar\merge-pendente.txt") do call :merge "%%a" "%%b" "%%c" "%%d"
echo.
echo Pronto. O gerente faz o pull e os registros. Pode fechar esta janela.
pause
exit /b 0

:merge
set "PR=%~1"
set "SHA=%~2"
set "ESTADO="
set "HEAD="
echo.
echo ==^> PR #%PR%
for /f "delims=" %%s in ('gh pr view %PR% -R aloirr/macuxifdv --json state -q .state') do set "ESTADO=%%s"
for /f "delims=" %%h in ('gh pr view %PR% -R aloirr/macuxifdv --json headRefOid -q .headRefOid') do set "HEAD=%%h"
echo     estado: !ESTADO!   head: !HEAD!
if /i "!ESTADO!"=="MERGED" (
  echo     Ja estava mesclado. Nada a fazer.
  exit /b 0
)
if /i not "!ESTADO!"=="OPEN" (
  echo     ERRO: PR nao esta aberto. Pulando.
  exit /b 1
)
if /i not "!HEAD!"=="%SHA%" (
  echo     ERRO: o head mudou ^(esperado %SHA%^). Nada foi feito neste PR.
  exit /b 1
)
gh pr merge %PR% -R aloirr/macuxifdv --squash --match-head-commit %SHA% --subject "%~3" --body "%~4"
if errorlevel 1 (
  echo     ERRO no merge do PR #%PR%.
  exit /b 1
)
echo     Merge feito.
exit /b 0
