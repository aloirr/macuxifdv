@echo off
setlocal
title Macuxi FDV - merge do PR #31 (guardiao v5)
cd /d "%~dp0.."
set "SHA=f86f59bbf832f0e394be14a5033f3dbfa0007818"

echo.
echo ==^> 1/4 Conferindo o PR #31
for /f "delims=" %%s in ('gh pr view 31 -R aloirr/macuxifdv --json state -q .state') do set "ESTADO=%%s"
for /f "delims=" %%h in ('gh pr view 31 -R aloirr/macuxifdv --json headRefOid -q .headRefOid') do set "HEAD=%%h"
echo     estado: %ESTADO%   head: %HEAD%
if /i "%ESTADO%"=="MERGED" goto ja_mesclado
if /i not "%ESTADO%"=="OPEN" goto erro_estado
if /i not "%HEAD%"=="%SHA%" goto erro_head

echo.
echo ==^> 2/4 Merge (squash) no commit autorizado
gh pr merge 31 -R aloirr/macuxifdv --squash --match-head-commit %SHA% --subject "T-0044: guardiao v5 - gh pr merge liberado so para o gerente, com trava" --body "Agente: alexandre"
if errorlevel 1 goto erro_merge
goto apagar

:ja_mesclado
echo     O PR #31 ja estava mesclado. Seguindo.

:apagar
echo.
echo ==^> 3/4 Apagando o branch de backup da T-0033
git push origin --delete nuvem/T-0033-ci-rapido-reserva
if errorlevel 1 echo     (aviso: o branch ja nao existia ou nao foi apagado; pode ignorar)

echo.
echo ==^> 4/4 Atualizando o repositorio local (git pull)
git pull --no-rebase --no-edit origin main
if errorlevel 1 goto erro_pull

echo.
echo Pronto. Pode fechar esta janela; o Claude reinicia o VS Code.
pause
exit /b 0

:erro_estado
echo.
echo ERRO: o PR #31 nao esta aberto (estado %ESTADO%). Nada foi feito.
pause
exit /b 1
:erro_head
echo.
echo ERRO: o head do PR mudou (%HEAD%), diferente do autorizado. Nada foi feito.
pause
exit /b 1
:erro_merge
echo.
echo ERRO no merge. Copie a mensagem acima e mande para o Claude.
pause
exit /b 1
:erro_pull
echo.
echo AVISO: o merge foi feito, mas o git pull nao terminou (o gerente faz o pull depois). Mande a mensagem acima para o Claude.
pause
exit /b 1
