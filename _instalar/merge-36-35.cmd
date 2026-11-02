@echo off
setlocal
title Macuxi FDV - merge dos PRs 36 e 35
cd /d "%~dp0.."

call :merge 36 146c73307dab89ce65c256cacec9a723a7a81f8f "T-0048: Conector 1.2.1 - nota faturada sem itens repetidos e ordem dos retornos" "Agente: modulo-integracao"
call :merge 35 9b7ff6247675f6f1d2114a5f644b81ada40801e1 "T-0049: CI detecta governanca sem assinatura e autorizacao de merge vinda de PR" "Agente: alexandre"

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
echo     estado: %ESTADO%   head: %HEAD%
if /i "%ESTADO%"=="MERGED" (
  echo     Ja estava mesclado. Nada a fazer.
  exit /b 0
)
if /i not "%ESTADO%"=="OPEN" (
  echo     ERRO: PR nao esta aberto. Pulando.
  exit /b 1
)
if /i not "%HEAD%"=="%SHA%" (
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
