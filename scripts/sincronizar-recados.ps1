<#
.SYNOPSIS
  Sincroniza o clone do repositorio de recados (macuxifdv-recados) com o GitHub. ADR 0035, T-0139.

.DESCRIPTION
  Roda a cada 2 min pelo Agendador de Tarefas do Windows e no inicio e no fim de cada sessao do Claude Code
  (hook .claude/hooks/sincronizar-recados.mjs). Fluxo:
    1. trava de execucao unica (mutex): se outra sincronizacao estiver rodando, sai na hora (codigo 0);
    2. limpeza de estado velho: rebase interrompido e index.lock abandonado (mais de 10 min);
    3. registra o que mudou no PC: recados NOVOS (recados/**) e lidos alterados (lidos/*.txt), num commit
       "recados: sync <host> <hora>" (so se houver mudanca);
    4. git pull --rebase --autostash (lidos/*.txt tem merge=union no .gitattributes: dois agentes marcando
       lidos ao mesmo tempo nao geram conflito) e registra o que chegou durante o pull;
    5. git push; se o GitHub recusar (alguem empurrou antes), volta ao passo 4 (ate -Tentativas vezes).
  Commit antes do pull (e nao depois) deixa o autostash quase sem nada para guardar: o que o PC tem vira commit,
  e o rebase junta com o que veio do GitHub.

  Garantias:
    - Nunca apaga recado: so entram no commit arquivos novos e lidos alterados. Recado apagado no PC e
      restaurado do git; recado alterado no PC nao sobe (recados sao imutaveis) e fica no log.
      Conflito no rebase: aborta (git rebase --abort devolve tudo como estava) e registra no log.
    - Nao trava: cada comando do git tem timeout (-TimeoutSegundos) e o script inteiro tem prazo
      (-PrazoSegundos); o git nunca pede senha (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never).
    - Nao le nem grava segredo: a credencial e a do Git Credential Manager do Windows. O log fica fora do
      repositorio (%LOCALAPPDATA%\Macuxi\recados-sync.log), sem URL com credencial nem conteudo de recado.
    - Sem Docker. PowerShell 5.1 do Windows. (Arquivo sem acentos de proposito: o PowerShell 5.1 le .ps1
      sem BOM como ANSI.)

  Saida (codigo): 0 = ok, nada a fazer, ocupado ou clone ausente (antes do corte) | 2 = conflito no rebase
  (abortado) | 3 = push recusado ou sem rede/credencial depois das tentativas | 4 = erro do git ou prazo.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\sincronizar-recados.ps1

.EXAMPLE
  Cadastro no Agendador (a cada 2 min, so com o usuario logado): scripts\recados\agendar-sincronizacao.ps1
  ou, em uma linha (cmd ou PowerShell):
  schtasks /Create /TN "Macuxi\Sincronizar recados" /SC MINUTE /MO 2 /IT /F /TR "conhost.exe --headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\sincronizar-recados.ps1 -Origem agendador"
#>
[CmdletBinding()]
param(
  [string]$Clone = $(if ($env:MACUXI_RECADOS_CLONE) { $env:MACUXI_RECADOS_CLONE } else { 'C:\macuxifdv-recados' }),
  [string]$Ramo = 'main',
  [string]$Remoto = 'origin',
  [string]$Log = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Macuxi\recados-sync.log' } else { Join-Path $env:TEMP 'macuxi-recados-sync.log' }),
  [int]$TimeoutSegundos = 40,
  [int]$PrazoSegundos = 100,
  [int]$Tentativas = 3,
  [string]$Origem = 'manual'
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:Prazo = (Get-Date).AddSeconds($PrazoSegundos)

function Escrever-Log([string]$Texto) {
  try {
    $pasta = Split-Path -Parent $Log
    if ($pasta -and -not (Test-Path -LiteralPath $pasta)) { New-Item -ItemType Directory -Path $pasta -Force | Out-Null }
    if ((Test-Path -LiteralPath $Log) -and ((Get-Item -LiteralPath $Log).Length -gt 1MB)) {
      Move-Item -LiteralPath $Log -Destination ($Log + '.1') -Force
    }
    $limpo = $Texto -replace '(?i)(https?://)[^/@\s]+@', '$1***@'   # nunca grava credencial de URL
    $linha = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $Origem, $limpo
    Add-Content -LiteralPath $Log -Value $linha -Encoding UTF8
  } catch {
    # log e acessorio: sem log, a sincronizacao segue
  }
}

function Sair([int]$Codigo, [string]$Mensagem, [switch]$Registrar) {
  if ($Registrar) { Escrever-Log $Mensagem }
  Write-Output ("sincronizar-recados: {0}" -f $Mensagem)
  exit $Codigo
}

function Formatar-Argumento([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Roda o git no clone com timeout; nunca pede credencial nem abre editor.
function Invoke-Git([string[]]$Argumentos) {
  $restante = [int](($script:Prazo - (Get-Date)).TotalMilliseconds)
  if ($restante -le 0) { return [pscustomobject]@{ Codigo = -2; Saida = ''; Erro = 'prazo esgotado' } }
  $limite = [Math]::Min($TimeoutSegundos * 1000, $restante)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = (@('-c', 'core.quotepath=off') + $Argumentos | ForEach-Object { Formatar-Argumento $_ }) -join ' '
  $psi.WorkingDirectory = $Clone
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
  $psi.EnvironmentVariables['GIT_EDITOR'] = 'true'
  $psi.EnvironmentVariables['GIT_SEQUENCE_EDITOR'] = 'true'
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($limite)) {
    try { & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null } catch { }
    return [pscustomobject]@{ Codigo = -1; Saida = ''; Erro = ('timeout de {0} s em git {1}' -f [int]($limite / 1000), $Argumentos[0]) }
  }
  $p.WaitForExit()
  return [pscustomobject]@{ Codigo = $p.ExitCode; Saida = $out.Result; Erro = $err.Result }
}

function Resumo([string]$Texto) {
  $t = ($Texto -replace '\s+', ' ').Trim()
  if ($t.Length -gt 300) { $t = $t.Substring(0, 300) + '...' }
  return $t
}

function Exigir($r, [string]$Passo) {
  if ($r.Codigo -ne 0) { Sair 4 ('erro em {0}: {1}' -f $Passo, (Resumo $r.Erro)) -Registrar }
}

function Lista-Z([string]$Texto) { return @($Texto -split "`0" | Where-Object { $_ -ne '' }) }

# Registra num commit o que mudou no PC: recados novos e lidos alterados. Devolve quantos arquivos entraram.
function Registrar-Mudancas {
  # Recado apagado no PC volta do git (recados nao se apagam); lidos apagado tambem.
  $apagados = @(Lista-Z (Invoke-Git @('ls-files', '-z', '--deleted', '--', 'recados', 'lidos')).Saida)
  if ($apagados.Count) {
    Escrever-Log ('{0} arquivo(s) apagado(s) no PC restaurado(s) do git (recados nao se apagam): {1}' -f $apagados.Count, (($apagados | Select-Object -First 5) -join ', '))
    foreach ($lote in (Lotes $apagados)) { Exigir (Invoke-Git (@('checkout', '--') + $lote)) 'restaurar apagados' }
  }
  # Recado existente alterado no PC: nao sobe (imutavel). Fica no log para o gerente ver.
  $alterados = @(Lista-Z (Invoke-Git @('ls-files', '-z', '--modified', '--', 'recados')).Saida)
  if ($alterados.Count) {
    Escrever-Log ('AVISO: {0} recado(s) alterado(s) no PC nao sobem (recados sao imutaveis): {1}' -f $alterados.Count, (($alterados | Select-Object -First 5) -join ', '))
  }
  $novos = @(Lista-Z (Invoke-Git @('ls-files', '-z', '--others', '--exclude-standard', '--', 'recados', 'lidos')).Saida)
  foreach ($lote in (Lotes $novos)) { Exigir (Invoke-Git (@('add', '--') + $lote)) 'add dos recados novos' }
  $lidos = @(Lista-Z (Invoke-Git @('ls-files', '-z', '--modified', '--', 'lidos')).Saida)
  foreach ($lote in (Lotes $lidos)) { Exigir (Invoke-Git (@('add', '--') + $lote)) 'add dos lidos' }
  $staged = @(Lista-Z (Invoke-Git @('diff', '--cached', '--name-only', '-z')).Saida)
  if (-not $staged.Count) { return 0 }
  $hora = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  Exigir (Invoke-Git @('commit', '-q', '--no-verify', '-m', ('recados: sync {0} {1}' -f $env:COMPUTERNAME, $hora))) 'commit'
  return $staged.Count
}

# Lotes de ate 200 caminhos (a linha de comando do Windows tem limite de 32 mil caracteres).
function Lotes($Itens) {
  $lista = @($Itens)
  for ($i = 0; $i -lt $lista.Count; $i += 200) {
    , ($lista[$i..([Math]::Min($i + 199, $lista.Count - 1))])
  }
}

function Rebase-EmAndamento {
  $gitDir = Join-Path $Clone '.git'
  return (Test-Path -LiteralPath (Join-Path $gitDir 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $gitDir 'rebase-apply'))
}

# ---------------------------------------------------------------- inicio

if (-not (Test-Path -LiteralPath (Join-Path $Clone '.git'))) {
  Sair 0 ('clone ausente ({0}): nada a sincronizar (antes do corte da ADR 0035)' -f $Clone)
}

$hash = [System.BitConverter]::ToString((New-Object System.Security.Cryptography.SHA1Managed).ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Clone.ToLowerInvariant()))).Replace('-', '').Substring(0, 12)
$trava = New-Object System.Threading.Mutex($false, ('Local\MacuxiSincronizarRecados-' + $hash))
$temTrava = $false
try {
  $temTrava = $trava.WaitOne(0)
} catch {
  # trava abandonada (a execucao anterior morreu segurando): passa a ser desta
  $ex = $_.Exception
  if ($ex -is [System.Threading.AbandonedMutexException] -or $ex.InnerException -is [System.Threading.AbandonedMutexException]) { $temTrava = $true } else { throw }
}
if (-not $temTrava) { Sair 0 'ocupado: outra sincronizacao em andamento' }

try {
  # Estado velho de uma execucao interrompida (PC desligado, processo morto pelo timeout).
  if (Rebase-EmAndamento) {
    Escrever-Log 'rebase interrompido encontrado: git rebase --abort (nada se perde)'
    Invoke-Git @('rebase', '--abort') | Out-Null
  }
  $lock = Join-Path $Clone '.git\index.lock'
  if ((Test-Path -LiteralPath $lock) -and ((Get-Item -LiteralPath $lock).LastWriteTime -lt (Get-Date).AddMinutes(-10))) {
    Escrever-Log 'index.lock abandonado (mais de 10 min) removido'
    Remove-Item -LiteralPath $lock -Force
  }

  $ramoAtual = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Saida.Trim()
  if ($ramoAtual -ne $Ramo) { Sair 4 ('o clone esta no ramo "{0}", e nao em "{1}": confira C:\macuxifdv-recados' -f $ramoAtual, $Ramo) -Registrar }

  $enviados = Registrar-Mudancas
  $tentativa = 0
  while ($true) {
    $tentativa++
    $pull = Invoke-Git @('pull', '-q', '--rebase', '--autostash', '--no-edit', $Remoto, $Ramo)
    if ($pull.Codigo -ne 0) {
      if (Rebase-EmAndamento) {
        Invoke-Git @('rebase', '--abort') | Out-Null
        Sair 2 ('conflito no pull --rebase: rebase abortado, nada foi apagado; o gerente confere ({0})' -f (Resumo $pull.Erro)) -Registrar
      }
      Sair 3 ('pull falhou (rede, credencial ou prazo): {0}' -f (Resumo $pull.Erro)) -Registrar
    }
    $enviados += Registrar-Mudancas   # o que chegou no PC durante o pull

    $adiante = (Invoke-Git @('rev-list', '--count', ('{0}/{1}..HEAD' -f $Remoto, $Ramo))).Saida.Trim()
    if ($adiante -eq '0') {
      if ($enviados -gt 0) { Sair 0 ('ok: {0} arquivo(s) ja no GitHub' -f $enviados) -Registrar }
      Sair 0 'ok: nada a enviar'
    }
    $push = Invoke-Git @('push', '-q', '--porcelain', $Remoto, ('HEAD:refs/heads/{0}' -f $Ramo))
    if ($push.Codigo -eq 0) { Sair 0 ('ok: {0} commit(s) enviado(s), {1} arquivo(s)' -f $adiante, $enviados) -Registrar }
    $recusado = ($push.Erro + $push.Saida) -match '(rejected|fetch first|non-fast-forward|\[rejected\])'
    if (-not $recusado -or $tentativa -ge $Tentativas) {
      Sair 3 ('push falhou na tentativa {0}: {1}' -f $tentativa, (Resumo ($push.Erro + ' ' + $push.Saida))) -Registrar
    }
    Escrever-Log ('push recusado (alguem enviou antes); tentativa {0} de {1}' -f $tentativa, $Tentativas)
  }
} finally {
  if ($temTrava) { try { $trava.ReleaseMutex() } catch { } }
  $trava.Dispose()
}
