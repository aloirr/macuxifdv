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
  [string]$Repo = '',   # vazio = raiz do repositorio deste script (resolvida no corpo)
  [string]$Nome = 'Sincronizar recados',   # outro nome so no teste (recados-ps.test.mjs)
  [switch]$Remover,
  [switch]$Simples,
  [switch]$Simular
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
# No PowerShell 5.1 com -File, $PSScriptRoot chega vazio nos padroes do param(): a pasta sai daqui, no corpo.
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $aqui '..\..')).Path }
. (Join-Path $aqui 'comum.ps1')

$caminho = '\Macuxi\'
$existente = Get-ScheduledTask -TaskPath $caminho -TaskName $Nome -ErrorAction SilentlyContinue

if ($Remover) {
  if (-not $existente) { Ok 'a tarefa nao existe: nada a remover'; exit 0 }
  Fazer ('remover a tarefa {0}{1}' -f $caminho, $Nome) { Unregister-ScheduledTask -TaskPath $caminho -TaskName $Nome -Confirm:$false }
  exit 0
}

$sincronizar = Join-Path $Repo 'scripts\sincronizar-recados.ps1'
if (-not (Test-Path -LiteralPath $sincronizar)) { Falhar ('{0} nao encontrado' -f $sincronizar) }
$ps = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Origem agendador' -f $sincronizar
# $acaoTarefa, e nao $acao: o bloco passado a Fazer roda dentro da funcao, cujo parametro [scriptblock]$Acao encobre
# (sem diferenca de maiusculas) a variavel do script; o Register-ScheduledTask recebia o bloco ("CimInstance[]").
$acaoTarefa = if ($Simples) { New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $ps }
else { New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless powershell.exe ' + $ps) }

$a2min = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2)
$noLogon = New-ScheduledTaskTrigger -AtLogOn -User ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME)
$quem = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
$regras = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden

Info ('acao: {0} {1}' -f $acaoTarefa.Execute, $acaoTarefa.Arguments)
Fazer ('cadastrar {0}{1} a cada 2 min, so com {2} logado{3}' -f $caminho, $Nome, $env:USERNAME, $(if ($Simples) { ' (modo simples)' } else { '' })) {
  Register-ScheduledTask -TaskPath $caminho -TaskName $Nome -Action $acaoTarefa -Trigger @($a2min, $noLogon) -Principal $quem -Settings $regras `
    -Description 'Sincroniza C:\macuxifdv-recados com o GitHub (ADR 0035, T-0139). Remover: scripts\recados\agendar-sincronizacao.ps1 -Remover' -Force | Out-Null
  Ok ('tarefa cadastrada; confira em 3 min: Get-ScheduledTaskInfo -TaskPath ''{0}'' -TaskName ''{1}''' -f $caminho, $Nome)
}
exit 0
