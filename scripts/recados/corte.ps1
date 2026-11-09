<#
.SYNOPSIS
  Corte dos recados para o repositorio proprio (ADR 0035, T-0139). Rodar com TODOS os agentes parados.

.DESCRIPTION
  O dono do produto roda uma vez, num PowerShell fora do VS Code, com o VS Code e o Claude Code fechados
  (um recado escrito durante o corte pode se perder). Passos:
    1. confere: agentes parados (processo "claude"), indice do repositorio de codigo sem nada preparado;
    2. clona o repositorio de recados (ou atualiza o clone que ja existe, se o remoto for o mesmo);
    3. copia .coord\recados e .coord\lidos para o clone, sem sobrescrever nada: recado igual e pulado,
       recado diferente com o mesmo nome PARA o corte (nada e apagado); lidos sao unidos linha a linha;
    4. garante o .gitattributes (lidos/*.txt merge=union), faz o commit da migracao e o push;
    5. confere arquivo por arquivo (hash) que tudo esta no clone;
    6. move as pastas originais para o backup (fora do repositorio) e cria as juncoes (mklink /J);
    7. tira as pastas do indice do repositorio de codigo (git rm -r --cached) e poe a marca no .gitignore
       (/.coord/recados e /.coord/lidos). O COMMIT fica para o gerente-projetos, com "Agente: alexandre";
    8. confere as juncoes, a contagem de arquivos e o "node scripts/coord.mjs caixa".
  Historico: o git do repositorio de codigo continua guardando a historia de cada recado (nao se reescreve
  historico); o repositorio novo comeca com um commit de migracao que cita o commit de origem. Justificativa
  na ADR 0035.

  Idempotente: rodar de novo depois do corte so confere. Reversivel: scripts\recados\volta.ps1.
  -Simular mostra o que faria, sem mudar nada (le o disco e o git, nao grava).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\corte.ps1 -Simular
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\corte.ps1
#>
[CmdletBinding()]
param(
  [string]$Remoto = 'https://github.com/aloirr/macuxifdv-recados.git',
  [string]$Clone = 'C:\macuxifdv-recados',
  [string]$Repo = '',   # vazio = raiz do repositorio deste script (resolvida no corpo)
  [string]$Backup = ('C:\macuxifdv-backup-recados-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [string]$Ramo = 'main',
  [switch]$Simular,
  [switch]$IgnorarProcessos
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
# No PowerShell 5.1 com -File, $PSScriptRoot chega vazio nos padroes do param(): a pasta sai daqui, no corpo.
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $aqui '..\..')).Path }
. (Join-Path $aqui 'comum.ps1')

$pastas = @('recados', 'lidos')
$coord = Join-Path $Repo '.coord'

Titulo ('Corte dos recados (ADR 0035)' + $(if ($Simular) { ' - SIMULACAO, nada sera alterado' } else { '' }))
Info ('repositorio de codigo: {0}' -f $Repo)
Info ('clone de recados:      {0}  (remoto {1})' -f $Clone, $Remoto)

# ---------------------------------------------------------------- 0. ja cortado?
$estado = @{}
foreach ($p in $pastas) { $estado[$p] = Estado-Pasta (Join-Path $coord $p) (Join-Path $Clone $p) }
if (@($estado.Values | Where-Object { $_ -eq 'juncao-certa' }).Count -eq $pastas.Count) {
  Info 'as duas pastas ja sao juncoes para o clone: o corte ja foi feito. Conferindo.'
  $ok = Conferir-Juncoes -Repo $Repo -Clone $Clone -Pastas $pastas
  if ($ok) { Ok 'corte conferido: nada a fazer.'; exit 0 }
  Falhar 'corte feito, mas a conferencia falhou (veja acima).'
}
foreach ($p in $pastas) {
  if ($estado[$p] -eq 'juncao-outra') { Falhar ('.coord\{0} e uma juncao para outro lugar: confira antes de seguir.' -f $p) }
  if ($estado[$p] -eq 'ausente') { Falhar ('.coord\{0} nao existe: nada a migrar (ja houve corte parcial? rode a volta antes).' -f $p) }
}

# ---------------------------------------------------------------- 1. conferencias
Passo '1. Conferencias'
Exigir-Git
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { Falhar ('{0} nao e um repositorio git' -f $Repo) }
Exigir-AgentesParados -Ignorar:$IgnorarProcessos
$preparado = (Git $Repo @('diff', '--cached', '--name-only')).Saida.Trim()
if ($preparado) { Falhar ('o indice do repositorio de codigo tem arquivos preparados; o gerente faz o commit antes do corte:' + "`n" + $preparado) }
$shaOrigem = (Git $Repo @('rev-parse', '--short', 'HEAD')).Saida.Trim()
Ok ('repositorio de codigo em {0}, indice limpo' -f $shaOrigem)

# ---------------------------------------------------------------- 2. clone
Passo '2. Clone do repositorio de recados'
if (Test-Path -LiteralPath (Join-Path $Clone '.git')) {
  $url = (Git $Clone @('remote', 'get-url', 'origin')).Saida.Trim()
  if ((Normalizar-Url $url) -ne (Normalizar-Url $Remoto)) { Falhar ('{0} ja existe com outro remoto ({1})' -f $Clone, $url) }
  Ok 'clone ja existe com o remoto certo'
  if ((Git $Clone @('rev-parse', '--verify', '-q', 'HEAD')).Codigo -eq 0) {
    Fazer 'git pull --rebase no clone' { Exigir (Git $Clone @('pull', '-q', '--rebase', 'origin', $Ramo)) 'pull do clone' }
  }
} elseif (Test-Path -LiteralPath $Clone) {
  Falhar ('{0} existe e nao e um clone git: renomeie ou apague a pasta e rode de novo' -f $Clone)
} else {
  Fazer ('git clone {0} {1}' -f $Remoto, $Clone) { Exigir (Git (Split-Path -Parent $Clone) @('clone', '-q', $Remoto, $Clone)) 'clone' }
}
if (-not $Simular -and (Git $Clone @('rev-parse', '--verify', '-q', 'HEAD')).Codigo -ne 0) {
  # repositorio vazio: o primeiro commit ja nasce no ramo certo
  Exigir (Git $Clone @('symbolic-ref', 'HEAD', ('refs/heads/{0}' -f $Ramo))) 'ramo inicial'
}

# ---------------------------------------------------------------- 3. copia
Passo '3. Copia de .coord\recados e .coord\lidos para o clone (sem sobrescrever)'
$plano = @()
$conflitos = @()
foreach ($arq in (Arquivos-Sob (Join-Path $coord 'recados'))) {
  $destino = Join-Path (Join-Path $Clone 'recados') $arq.Rel
  if (-not (Test-Path -LiteralPath $destino)) { $plano += , @($arq.Caminho, $destino) }
  elseif ((Hash $arq.Caminho) -ne (Hash $destino)) { $conflitos += $arq.Rel }
}
if ($conflitos.Count) {
  Falhar ("recado com o mesmo nome e conteudo diferente no clone (nada foi alterado):`n  " + (($conflitos | Select-Object -First 20) -join "`n  "))
}
$lidos = @(Arquivos-Sob (Join-Path $coord 'lidos'))
Info ('{0} arquivo(s) de recado a copiar; {1} arquivo(s) de lidos a unir' -f $plano.Count, $lidos.Count)
Fazer ('copiar {0} recado(s)' -f $plano.Count) {
  foreach ($par in $plano) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $par[1]) | Out-Null
    Copy-Item -LiteralPath $par[0] -Destination $par[1]
  }
}
Fazer ('unir {0} arquivo(s) de lidos' -f $lidos.Count) {
  foreach ($arq in $lidos) { Unir-Linhas -Origem $arq.Caminho -Destino (Join-Path (Join-Path $Clone 'lidos') $arq.Rel) }
}

# ---------------------------------------------------------------- 4. .gitattributes, commit e push
Passo '4. .gitattributes, commit da migracao e push'
Fazer 'garantir .gitattributes (lidos/*.txt merge=union) e README' {
  Garantir-ArquivosDoClone -Clone $Clone -Repo $Repo
}
Fazer ('commit "recados: migracao de macuxifdv@{0}" e push' -f $shaOrigem) {
  Exigir (Git $Clone (@('add', '--', 'recados', 'lidos') + $script:ArquivosDoClone)) 'add da migracao'
  if ((Git $Clone @('diff', '--cached', '--quiet')).Codigo -ne 0) {
    $msg = "recados: migracao de macuxifdv@$shaOrigem (T-0139, ADR 0035)`n`nCopia de .coord/recados e .coord/lidos do repositorio aloirr/macuxifdv no commit $shaOrigem.`nO historico de cada recado continua no repositorio de codigo (git log -- .coord/recados)."
    Exigir (Git $Clone @('commit', '-q', '--no-verify', '-m', $msg)) 'commit da migracao'
  }
  Exigir (Git $Clone @('push', '-q', '-u', 'origin', ('HEAD:refs/heads/{0}' -f $Ramo))) 'push da migracao'
  Exigir (Git $Clone @('branch', '-q', ('--set-upstream-to=origin/{0}' -f $Ramo))) 'upstream do clone'
}

# ---------------------------------------------------------------- 5. conferencia antes do corte
Passo '5. Conferencia arquivo por arquivo'
if (-not $Simular) {
  $faltam = @()
  foreach ($arq in (Arquivos-Sob (Join-Path $coord 'recados'))) {
    $d = Join-Path (Join-Path $Clone 'recados') $arq.Rel
    if (-not (Test-Path -LiteralPath $d) -or (Hash $arq.Caminho) -ne (Hash $d)) { $faltam += ('recados\' + $arq.Rel) }
  }
  foreach ($arq in (Arquivos-Sob (Join-Path $coord 'lidos'))) {
    $d = Join-Path (Join-Path $Clone 'lidos') $arq.Rel
    $tem = if (Test-Path -LiteralPath $d) { @{} } else { $null }
    if ($null -eq $tem) { $faltam += ('lidos\' + $arq.Rel); continue }
    foreach ($l in (Get-Content -LiteralPath $d -Encoding UTF8)) { $tem[$l] = $true }
    foreach ($l in (Get-Content -LiteralPath $arq.Caminho -Encoding UTF8)) { if ($l -and -not $tem.ContainsKey($l)) { $faltam += ('lidos\' + $arq.Rel + ' (' + $l + ')'); break } }
  }
  if ($faltam.Count) { Falhar ("faltam no clone (nada foi movido):`n  " + (($faltam | Select-Object -First 20) -join "`n  ")) }
  $pendente = (Git $Clone @('status', '--porcelain')).Saida.Trim()
  if ($pendente) { Falhar ("o clone tem mudancas fora do commit (nada foi movido):`n" + $pendente) }
  Ok 'tudo no clone e no GitHub'
}

# ---------------------------------------------------------------- 6. backup e juncoes
Passo '6. Backup das pastas originais e juncoes'
Fazer ('mover .coord\recados e .coord\lidos para {0}' -f $Backup) {
  New-Item -ItemType Directory -Force -Path $Backup | Out-Null
  foreach ($p in $pastas) { Move-Item -LiteralPath (Join-Path $coord $p) -Destination (Join-Path $Backup $p) }
}
Fazer 'criar as juncoes (mklink /J)' {
  foreach ($p in $pastas) { Criar-Juncao -Caminho (Join-Path $coord $p) -Alvo (Join-Path $Clone $p) }
}

# ---------------------------------------------------------------- 7. repositorio de codigo
Passo '7. Repositorio de codigo: indice e .gitignore (o commit e do gerente)'
Fazer 'git rm -r --cached .coord/recados .coord/lidos' {
  Exigir (Git $Repo @('rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.coord/recados', '.coord/lidos')) 'git rm --cached'
}
Fazer 'marca no .gitignore (/.coord/recados e /.coord/lidos)' {
  Garantir-MarcaGitignore -Repo $Repo
  Exigir (Git $Repo @('add', '--', '.gitignore')) 'add do .gitignore'
}

# ---------------------------------------------------------------- 8. conferencia final
Passo '8. Conferencia final'
if ($Simular) { Ok 'simulacao concluida: nada foi alterado.'; exit 0 }
if (-not (Conferir-Juncoes -Repo $Repo -Clone $Clone -Pastas $pastas -Backup $Backup)) { Falhar 'a conferencia falhou: rode scripts\recados\volta.ps1 e avise o gerente.' }

Titulo 'Corte feito'
Info ('backup das pastas originais: {0} (guarde ate o fim da semana)' -f $Backup)
Info 'proximos passos:'
Info '  1. gerente-projetos: commit do indice e do .gitignore com "Agente: alexandre" no ultimo bloco da mensagem'
Info '     (T-0139: recados e lidos saem do repositorio de codigo, ADR 0035) e push pelo rito de governanca;'
Info '  2. Agendador: scripts\recados\agendar-sincronizacao.ps1;'
Info '  3. testes do passo a passo (docs\desenho\T-0139-passo-a-passo.md).'
exit 0
