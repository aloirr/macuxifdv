<#
.SYNOPSIS
  Plano de volta do corte dos recados (ADR 0035, T-0139). Rodar com TODOS os agentes parados.

.DESCRIPTION
  Desfaz o corte sem perder nada:
    1. confere: agentes parados; as pastas .coord\recados e .coord\lidos sao juncoes (senao, ja esta na volta);
    2. sincroniza uma ultima vez (pull e push do clone), para trazer o que chegou pelo GitHub (formulario);
    3. remove SO as juncoes (rmdir, sem entrar no clone) e copia recados e lidos do clone para .coord\
       (pastas de verdade de novo);
    4. tira a marca do .gitignore e prepara no indice do repositorio de codigo a volta das pastas
       (git add); o COMMIT e do gerente-projetos, com "Agente: alexandre";
    5. remove a tarefa do Agendador (a menos que -ManterAgendamento).
  O clone C:\macuxifdv-recados e o repositorio no GitHub ficam como arquivo (nao se apaga nada). Para parar
  as Actions de la, o dono do produto arquiva o repositorio no GitHub (Settings > Archive).
  Idempotente: sem juncao, so informa. -Simular mostra o que faria.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\volta.ps1 -Simular
#>
[CmdletBinding()]
param(
  [string]$Clone = 'C:\macuxifdv-recados',
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$Simular,
  [switch]$IgnorarProcessos,
  [switch]$ManterAgendamento,
  [switch]$SemSincronizar
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

$pastas = @('recados', 'lidos')
$coord = Join-Path $Repo '.coord'

Titulo ('Volta dos recados para o repositorio de codigo (ADR 0035)' + $(if ($Simular) { ' - SIMULACAO, nada sera alterado' } else { '' }))

$estado = @{}
foreach ($p in $pastas) { $estado[$p] = Estado-Pasta (Join-Path $coord $p) (Join-Path $Clone $p) }
if (@($estado.Values | Where-Object { $_ -eq 'pasta' }).Count -eq $pastas.Count) {
  Ok '.coord\recados e .coord\lidos ja sao pastas de verdade: nada a voltar.'
  exit 0
}
foreach ($p in $pastas) {
  if ($estado[$p] -eq 'juncao-outra') { Falhar ('.coord\{0} e juncao para outro lugar: confira antes de seguir' -f $p) }
}

Passo '1. Conferencias'
Exigir-Git
Exigir-AgentesParados -Ignorar:$IgnorarProcessos
if (-not (Test-Path -LiteralPath (Join-Path $Clone '.git'))) { Falhar ('clone {0} nao encontrado: sem ele nao ha de onde copiar' -f $Clone) }

Passo '2. Ultima sincronizacao'
if ($SemSincronizar) { Info 'pulada (-SemSincronizar)' }
else {
  Fazer 'scripts\sincronizar-recados.ps1' {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\sincronizar-recados.ps1') -Clone $Clone -Origem volta | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) { Info ('AVISO: a sincronizacao saiu com {0}; a volta segue com o que o clone tem' -f $LASTEXITCODE) }
  }
}

Passo '3. Juncoes viram pastas de verdade'
foreach ($p in $pastas) {
  $c = Join-Path $coord $p
  $origem = Join-Path $Clone $p
  if ($estado[$p] -eq 'juncao-certa') { Fazer ('remover a juncao .coord\{0} (o clone fica intacto)' -f $p) { Remover-Juncao $c } }
  elseif ($estado[$p] -eq 'pasta') { Info ('.coord\{0} ja e pasta: so completa com o que falta' -f $p) }
  Fazer ('copiar {0} do clone para .coord\{1} (sem sobrescrever)' -f $origem, $p) {
    New-Item -ItemType Directory -Force -Path $c | Out-Null
    foreach ($arq in (Arquivos-Sob $origem)) {
      $d = Join-Path $c $arq.Rel
      if ($p -eq 'lidos') { Unir-Linhas -Origem $arq.Caminho -Destino $d; continue }
      if (Test-Path -LiteralPath $d) { continue }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d) | Out-Null
      Copy-Item -LiteralPath $arq.Caminho -Destination $d
    }
  }
}

Passo '4. Repositorio de codigo: .gitignore e indice (o commit e do gerente)'
Fazer 'tirar a marca do .gitignore e git add das pastas' {
  Remover-MarcaGitignore -Repo $Repo
  Exigir (Git $Repo @('add', '--', '.gitignore', '.coord/recados', '.coord/lidos')) 'git add da volta'
}

Passo '5. Agendador'
if ($ManterAgendamento) { Info 'mantido (-ManterAgendamento)' }
else {
  Fazer 'remover a tarefa "\Macuxi\Sincronizar recados"' {
    $t = Get-ScheduledTask -TaskPath '\Macuxi\' -TaskName 'Sincronizar recados' -ErrorAction SilentlyContinue
    if ($t) { Unregister-ScheduledTask -TaskPath '\Macuxi\' -TaskName 'Sincronizar recados' -Confirm:$false }
  }
}

if ($Simular) { Ok 'simulacao concluida: nada foi alterado.'; exit 0 }
foreach ($p in $pastas) {
  if ((Estado-Pasta (Join-Path $coord $p) (Join-Path $Clone $p)) -ne 'pasta') { Falhar ('.coord\{0} nao virou pasta de verdade' -f $p) }
}
$faltam = @(Arquivos-Sob (Join-Path $Clone 'recados') | Where-Object { -not (Test-Path -LiteralPath (Join-Path (Join-Path $coord 'recados') $_.Rel)) })
if ($faltam.Count) { Falhar ('{0} recado(s) do clone nao chegaram a .coord\recados' -f $faltam.Count) }

Titulo 'Volta feita'
Info 'proximos passos:'
Info '  1. gerente-projetos: commit do .gitignore e das pastas com "Agente: alexandre" (T-0139: volta dos recados);'
Info '  2. dono do produto: arquivar o macuxifdv-recados no GitHub (Settings > Archive) para parar as Actions;'
Info '  3. o diff de governanca da T-0139 pode ficar: sem juncao, guardiao e coord.mjs voltam a regra de antes.'
exit 0
