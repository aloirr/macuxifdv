<#
.SYNOPSIS
  Cadastra no Agendador de Tarefas do Windows a sincronizacao dos recados a cada 2 min (ADR 0035, T-0139).

.DESCRIPTION
  Tarefa "\Macuxi\Sincronizar recados": roda scripts\sincronizar-recados.ps1 a cada 2 minutos e no logon,
  SO com o usuario logado (a credencial do Git Credential Manager e a dele; nenhuma senha e guardada na tarefa).
  Nao empilha: uma instancia por vez (MultipleInstances IgnoreNew) e limite de 2 min por execucao, alem da trava
  propria do script. Sem janela piscando: usa "conhost.exe --headless" (Windows 10 1809+ e 11); se a tarefa nao
  rodar (Ultimo resultado diferente de 0x0), cadastre de novo com -Simples (powershell oculto, pisca rapido).
  -Remover tira a tarefa. -Simular so mostra o que faria.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\agendar-sincronizacao.ps1
  Get-ScheduledTaskInfo -TaskPath '\Macuxi\' -TaskName 'Sincronizar recados'   # LastTaskResult 0 = ok

.EXAMPLE
  Equivalente em uma linha (cmd), sem o limite de 2 min por execucao:
  schtasks /Create /TN "Macuxi\Sincronizar recados" /SC MINUTE /MO 2 /IT /F /TR "conhost.exe --headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\sincronizar-recados.ps1 -Origem agendador"
#>
[CmdletBinding()]
param(
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$Remover,
  [switch]$Simples,
  [switch]$Simular
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

$caminho = '\Macuxi\'
$nome = 'Sincronizar recados'
$existente = Get-ScheduledTask -TaskPath $caminho -TaskName $nome -ErrorAction SilentlyContinue

if ($Remover) {
  if (-not $existente) { Ok 'a tarefa nao existe: nada a remover'; exit 0 }
  Fazer ('remover a tarefa {0}{1}' -f $caminho, $nome) { Unregister-ScheduledTask -TaskPath $caminho -TaskName $nome -Confirm:$false }
  exit 0
}

$script = Join-Path $Repo 'scripts\sincronizar-recados.ps1'
if (-not (Test-Path -LiteralPath $script)) { Falhar ('{0} nao encontrado' -f $script) }
$ps = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Origem agendador' -f $script
$acao = if ($Simples) { New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $ps }
else { New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless powershell.exe ' + $ps) }

$a2min = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2)
$noLogon = New-ScheduledTaskTrigger -AtLogOn -User ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME)
$quem = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
$regras = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden

Fazer ('cadastrar {0}{1} a cada 2 min, so com {2} logado{3}' -f $caminho, $nome, $env:USERNAME, $(if ($Simples) { ' (modo simples)' } else { '' })) {
  Register-ScheduledTask -TaskPath $caminho -TaskName $nome -Action $acao -Trigger @($a2min, $noLogon) -Principal $quem -Settings $regras `
    -Description 'Sincroniza C:\macuxifdv-recados com o GitHub (ADR 0035, T-0139). Remover: scripts\recados\agendar-sincronizacao.ps1 -Remover' -Force | Out-Null
  Ok 'tarefa cadastrada; confira em 3 min: Get-ScheduledTaskInfo -TaskPath ''\Macuxi\'' -TaskName ''Sincronizar recados'''
}
exit 0
