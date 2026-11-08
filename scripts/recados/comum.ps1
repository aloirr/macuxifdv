# Funcoes comuns do corte e da volta dos recados (ADR 0035, T-0139). Carregado com ". comum.ps1".
# PowerShell 5.1 do Windows. Sem acentos de proposito (o PowerShell 5.1 le .ps1 sem BOM como ANSI).
# As funcoes que gravam passam por "Fazer", que so mostra a acao quando o script roda com -Simular.

function Titulo([string]$t) { Write-Host ''; Write-Host ('== ' + $t) -ForegroundColor Cyan }
function Passo([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor White }
function Info([string]$t) { Write-Host ('   ' + $t) }
function Ok([string]$t) { Write-Host ('   ok: ' + $t) -ForegroundColor Green }
function Falhar([string]$t) { Write-Host ('   ERRO: ' + $t) -ForegroundColor Red; exit 1 }

# Acao que grava: em -Simular so descreve.
function Fazer([string]$Descricao, [scriptblock]$Acao) {
  if ($Simular) { Write-Host ('   [simulacao] ' + $Descricao) -ForegroundColor Yellow; return }
  Write-Host ('   ' + $Descricao + '...')
  & $Acao
}

function Formatar-Argumento([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# git sem prompt de credencial, com stdout/stderr separados (no PowerShell 5.1, "2>&1" de comando nativo com
# $ErrorActionPreference = 'Stop' vira erro terminal; por isso o processo e iniciado a mao).
function Git([string]$Pasta, [string[]]$Argumentos, [int]$TimeoutSegundos = 300) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = (@('-c', 'core.quotepath=off') + $Argumentos | ForEach-Object { Formatar-Argumento $_ }) -join ' '
  $psi.WorkingDirectory = $Pasta
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $psi.EnvironmentVariables['GIT_EDITOR'] = 'true'
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutSegundos * 1000)) {
    try { & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null } catch { }
    return [pscustomobject]@{ Codigo = -1; Saida = ''; Erro = 'timeout' }
  }
  $p.WaitForExit()
  return [pscustomobject]@{ Codigo = $p.ExitCode; Saida = $out.Result; Erro = $err.Result }
}

function Exigir($r, [string]$Passo) {
  if ($r.Codigo -ne 0) { Falhar ('{0}: {1}' -f $Passo, (($r.Erro + ' ' + $r.Saida) -replace '(?i)(https?://)[^/@\s]+@', '$1***@').Trim()) }
}

function Exigir-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falhar 'git nao encontrado no PATH' }
}

# Nenhum Claude Code rodando (VS Code com a extensao, terminal ou app): um recado escrito no meio do corte se perde.
function Exigir-AgentesParados([switch]$Ignorar) {
  $rodando = @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue)
  if ($rodando.Count -and -not $Ignorar) {
    Falhar ('ha {0} processo(s) "claude" rodando: feche o VS Code e todas as sessoes do Claude Code e rode de novo' -f $rodando.Count)
  }
  if ($rodando.Count) { Info ('AVISO: {0} processo(s) "claude" rodando (ignorado por -IgnorarProcessos)' -f $rodando.Count) }
  else { Ok 'nenhum Claude Code rodando' }
}

function Normalizar-Url([string]$u) {
  return (($u.Trim() -replace '(?i)^(https?://)[^/@]+@', '$1') -replace '/+$', '' -replace '(?i)\.git$', '').ToLowerInvariant()
}

function Caminho-Normal([string]$p) {
  return ([System.IO.Path]::GetFullPath($p)).TrimEnd('\', '/').ToLowerInvariant()
}

# 'ausente' | 'pasta' | 'juncao-certa' (aponta para $Alvo) | 'juncao-outra'
function Estado-Pasta([string]$Caminho, [string]$Alvo) {
  if (-not (Test-Path -LiteralPath $Caminho)) {
    # juncao quebrada (alvo sumiu) tambem cai aqui pelo Test-Path; confere o atributo
    $item = Get-Item -LiteralPath $Caminho -Force -ErrorAction SilentlyContinue
    if (-not $item) { return 'ausente' }
  } else {
    $item = Get-Item -LiteralPath $Caminho -Force
  }
  if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { return 'pasta' }
  $destino = @($item.Target)[0]
  if ($destino -and (Caminho-Normal $destino) -eq (Caminho-Normal $Alvo)) { return 'juncao-certa' }
  return 'juncao-outra'
}

# Arquivos (recursivo) com o caminho relativo a $Pasta.
function Arquivos-Sob([string]$Pasta) {
  if (-not (Test-Path -LiteralPath $Pasta)) { return @() }
  $base = (Get-Item -LiteralPath $Pasta -Force).FullName.TrimEnd('\') + '\'
  return @(Get-ChildItem -LiteralPath $Pasta -Recurse -File -Force | ForEach-Object {
      [pscustomobject]@{ Caminho = $_.FullName; Rel = $_.FullName.Substring($base.Length) }
    })
}

function Hash([string]$f) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash }

$script:Utf8SemBom = New-Object System.Text.UTF8Encoding($false)

# Lidos: une as linhas da origem no destino (sem repetir, sem apagar nada), com "\n" como o coord.mjs grava.
function Unir-Linhas([string]$Origem, [string]$Destino) {
  if (-not (Test-Path -LiteralPath $Destino)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destino) | Out-Null
    Copy-Item -LiteralPath $Origem -Destination $Destino
    return
  }
  $tem = @{}
  foreach ($l in [System.IO.File]::ReadAllLines($Destino, $script:Utf8SemBom)) { $tem[$l] = $true }
  $novas = @([System.IO.File]::ReadAllLines($Origem, $script:Utf8SemBom) | Where-Object { $_ -and -not $tem.ContainsKey($_) })
  if (-not $novas.Count) { return }
  $atual = [System.IO.File]::ReadAllText($Destino, $script:Utf8SemBom)
  $prefixo = if ($atual.Length -and -not $atual.EndsWith("`n")) { "`n" } else { '' }
  [System.IO.File]::AppendAllText($Destino, $prefixo + (($novas -join "`n") + "`n"), $script:Utf8SemBom)
}

# Arquivos do repositorio de recados (docs\desenho\T-0139-repo-recados): copia o que falta no clone, sem sobrescrever.
# Sem a pasta, grava ao menos o .gitattributes minimo. Em qualquer caso, garante a linha do merge=union.
function Garantir-ArquivosDoClone([string]$Clone, [string]$Repo) {
  $modelo = Join-Path $Repo 'docs\desenho\T-0139-repo-recados'
  foreach ($arq in (Arquivos-Sob $modelo)) {
    $d = Join-Path $Clone $arq.Rel
    if (Test-Path -LiteralPath $d) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d) | Out-Null
    Copy-Item -LiteralPath $arq.Caminho -Destination $d
  }
  $ga = Join-Path $Clone '.gitattributes'
  $texto = if (Test-Path -LiteralPath $ga) { [System.IO.File]::ReadAllText($ga, $script:Utf8SemBom) } else { '' }
  if ($texto -notmatch '(?m)^lidos/\*\.txt\s+.*merge=union') {
    $prefixo = if ($texto.Length -and -not $texto.EndsWith("`n")) { "`n" } else { '' }
    [System.IO.File]::AppendAllText($ga, $prefixo + "* text=auto eol=lf`nlidos/*.txt text eol=lf merge=union`n", $script:Utf8SemBom)
  }
  $readme = Join-Path $Clone 'README.md'
  if (-not (Test-Path -LiteralPath $readme)) {
    [System.IO.File]::WriteAllText($readme, "# macuxifdv-recados`n`nRecados do time Macuxi (ADR 0035 no repositorio aloirr/macuxifdv).`n", $script:Utf8SemBom)
  }
}

function Criar-Juncao([string]$Caminho, [string]$Alvo) {
  if (-not (Test-Path -LiteralPath $Alvo)) { New-Item -ItemType Directory -Force -Path $Alvo | Out-Null }
  $saida = & cmd.exe /c mklink /J "$Caminho" "$Alvo" 2>&1
  if ($LASTEXITCODE -ne 0) { Falhar ('mklink /J falhou para {0}: {1}' -f $Caminho, ($saida -join ' ')) }
}

# Remove SO a juncao (rmdir sem /s nao entra na pasta de destino). Nunca use Remove-Item -Recurse numa juncao.
function Remover-Juncao([string]$Caminho) {
  $item = Get-Item -LiteralPath $Caminho -Force
  if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { Falhar ('{0} nao e juncao: nada removido' -f $Caminho) }
  $saida = & cmd.exe /c rmdir "$Caminho" 2>&1
  if ($LASTEXITCODE -ne 0) { Falhar ('rmdir da juncao {0} falhou: {1}' -f $Caminho, ($saida -join ' ')) }
}

$script:MarcaComentario = '# Recados e lidos moram no repositorio macuxifdv-recados (ADR 0035); aqui sao juncoes para o clone'
$script:MarcaLinhas = @('/.coord/recados', '/.coord/lidos')

function Garantir-MarcaGitignore([string]$Repo) {
  $gi = Join-Path $Repo '.gitignore'
  $texto = if (Test-Path -LiteralPath $gi) { [System.IO.File]::ReadAllText($gi, $script:Utf8SemBom) } else { '' }
  $faltam = @($script:MarcaLinhas | Where-Object { $texto -notmatch ('(?m)^/?' + [regex]::Escape($_.TrimStart('/')) + '/?\s*$') })
  if (-not $faltam.Count) { return }
  $nl = if ($texto -match "`r`n") { "`r`n" } else { "`n" }
  $prefixo = if ($texto.Length -and -not $texto.EndsWith("`n")) { $nl } else { '' }
  [System.IO.File]::AppendAllText($gi, $prefixo + $script:MarcaComentario + $nl + ($faltam -join $nl) + $nl, $script:Utf8SemBom)
}

function Remover-MarcaGitignore([string]$Repo) {
  $gi = Join-Path $Repo '.gitignore'
  if (-not (Test-Path -LiteralPath $gi)) { return }
  $texto = [System.IO.File]::ReadAllText($gi, $script:Utf8SemBom)
  $nl = if ($texto -match "`r`n") { "`r`n" } else { "`n" }
  $linhas = $texto -split "`r?`n"
  $fica = @($linhas | Where-Object {
      $_ -ne $script:MarcaComentario -and $_ -notmatch '^/?\.coord/(recados|lidos)/?\s*$'
    })
  $novo = ($fica -join $nl)
  [System.IO.File]::WriteAllText($gi, $novo, $script:Utf8SemBom)
}

# Conferencia das juncoes depois do corte: alvo certo, nada faltando em relacao ao backup, pastas ignoradas no
# repositorio de codigo, clone sem pendencia e o coord.mjs lendo a caixa pela juncao.
function Conferir-Juncoes([string]$Repo, [string]$Clone, [string[]]$Pastas, [string]$Backup) {
  $ok = $true
  foreach ($p in $Pastas) {
    $c = Join-Path (Join-Path $Repo '.coord') $p
    $e = Estado-Pasta $c (Join-Path $Clone $p)
    if ($e -ne 'juncao-certa') { Info ('.coord\{0}: {1} (esperado: juncao para {2})' -f $p, $e, (Join-Path $Clone $p)); $ok = $false; continue }
    $n = @(Arquivos-Sob $c).Count
    Ok ('.coord\{0} -> {1} ({2} arquivo(s) pela juncao)' -f $p, (Join-Path $Clone $p), $n)
    if ($Backup -and (Test-Path -LiteralPath (Join-Path $Backup $p))) {
      $faltam = @(Arquivos-Sob (Join-Path $Backup $p) | Where-Object { -not (Test-Path -LiteralPath (Join-Path $c $_.Rel)) })
      if ($faltam.Count) { Info ('{0} arquivo(s) do backup nao aparecem pela juncao: {1}' -f $faltam.Count, (($faltam | Select-Object -First 5 | ForEach-Object { $_.Rel }) -join ', ')); $ok = $false }
    }
  }
  $soltos = @(((Git $Repo @('status', '--porcelain', '--untracked-files=all', '--', '.coord/recados', '.coord/lidos')).Saida -split "`n") | Where-Object { $_ -like '`?`? *' })
  if ($soltos.Count) { Info ('o repositorio de codigo ve {0} arquivo(s) nao rastreado(s) nas pastas de recados (falta a marca no .gitignore?)' -f $soltos.Count); $ok = $false }
  else { Ok 'repositorio de codigo ignora as juncoes' }
  $pendente = (Git $Clone @('status', '--porcelain')).Saida.Trim()
  if ($pendente) { Info 'o clone tem mudancas nao enviadas (a sincronizacao envia)' } else { Ok 'clone sem pendencias' }
  $coord = Join-Path $Repo 'scripts\coord.mjs'
  if ((Test-Path -LiteralPath $coord) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $null = & node $coord caixa gerente-projetos 2>&1
    if ($LASTEXITCODE -ne 0) { Info 'node scripts/coord.mjs caixa gerente-projetos falhou pela juncao'; $ok = $false }
    else { Ok 'node scripts/coord.mjs caixa le os recados pela juncao' }
  }
  return $ok
}
