@echo off
rem cloudflared simulado para os testes da demo (T-0038). Nao fala com a Cloudflare e nao le nada de %USERPROFILE%.
rem Pasta de trabalho: MACUXI_SIMULADO_DIR. Arquivos que o teste prepara nela:
rem   list.json             saida do "tunnel list --output json" (sem ele: lista vazia "[]")
rem   create.erro           se existir, "tunnel create" falha com este texto no stderr e codigo 1
rem   list-apos-create.json se existir, vira o list.json a partir do 1o "tunnel create" (com ou sem create.erro)
rem Cada chamada vai para chamadas.log (uma linha por chamada).
setlocal
set "D=%MACUXI_SIMULADO_DIR%"
if not defined D (
  echo MACUXI_SIMULADO_DIR nao definido 1>&2
  exit /b 9
)
echo %*>>"%D%\chamadas.log"

if /i "%~2"=="list" goto list
if /i "%~2"=="create" goto create
if /i "%~2"=="route" goto route
if /i "%~2"=="--config" goto validate
echo comando simulado desconhecido: %* 1>&2
exit /b 2

:list
if exist "%D%\list.json" (
  type "%D%\list.json"
) else (
  echo []
)
exit /b 0

:create
if exist "%D%\list-apos-create.json" copy /y "%D%\list-apos-create.json" "%D%\list.json" >nul
if exist "%D%\create.erro" (
  type "%D%\create.erro" 1>&2
  exit /b 1
)
echo Created tunnel %~3 with id 3f1c2b7a-9d4e-4b8a-a6c1-0e5d7f2a9b13
exit /b 0

:route
echo INF Added CNAME %~5 which will route to this tunnel 1>&2
exit /b 0

:validate
echo Validating rules from %~3
echo OK
exit /b 0
