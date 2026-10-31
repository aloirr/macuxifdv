@echo off
REM Copia a configuracao do Claude Code (agentes, skills, hooks, settings) para a pasta .claude
xcopy "%~dp0_instalar\claude" "%~dp0.claude" /E /I /Y
echo.
echo Pronto: pasta .claude criada em %~dp0
pause
