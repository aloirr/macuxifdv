<#
.SYNOPSIS
  Sobe a demonstração do Macuxi FDV (T-0026, T-0038): Postgres + migrações, base de demo, API (+ worker), BKO e túnel HTTPS.

.DESCRIPTION
  1. confere o Docker (tenta abrir o Docker Desktop se estiver parado);
  2. sobe o Postgres (db/docker-compose.yml) e aplica as migrações (banco subir);
  3. carrega a base de demo (banco seed demo --recriar; com -Manter, upsert sem apagar o que o app gravou);
  4. sobe a API (porta 8100) e o worker da outbox, com MACUXI_TRUST_PROXY=loopback (limite de login por aparelho);
  5. constrói o BKO (next build), que chama a API pelo proxy do próprio Next (/api-proxy -> 127.0.0.1:8100);
  6. abre o túnel: o NOMEADO (macuxi-demo: https://api-demo.macuxifdv.com.br e https://bko-demo.macuxifdv.com.br) se o
     configurar-dominio.ps1 já rodou neste PC; senão, ou se ele não conectar, o túnel rápido (trycloudflare, um
     endereço que muda a cada subida), com aviso;
  7. sobe o BKO (next start na porta 3100, só no loopback) e confere /v1/saude e a página do BKO, primeiro no PC e
     depois pelos endereços públicos, antes de dizer "pronto".
  Para parar: scripts\demo\derrubar-demo.ps1. Processos e logs ficam em .dados\demo\ (fora do git).
  Credenciais da Cloudflare (%USERPROFILE%\.cloudflared): este script não lê nem copia nada de lá; só chama o cloudflared.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1
  powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1 -Manter -SemWorker
#>
[CmdletBinding()]
param(
  # Não apaga a base de demo: só atualiza (upsert); visitas e pedidos do ensaio continuam.
  [switch]$Manter,
  # Não sobe o worker da outbox (eventos entre módulos ficam na fila até ele subir).
  [switch]$SemWorker,
  # Não sobe o BKO (só a API e o túnel).
  [switch]$SemBko,
  # Não abre o túnel (só API e BKO locais, ex.: emulador ou aparelho na mesma rede).
  [switch]$SemTunel,
  # Usa o túnel rápido (trycloudflare) mesmo com o domínio fixo configurado.
  [switch]$TunelRapido,
  # Sem winget/administrador: usa (ou baixa) o cloudflared portátil em .dados\demo\bin.
  [switch]$Portatil,
  # Derruba a demo que estiver no ar e sobe de novo (sem isso, o script recusa para não derrubar a de outra janela).
  [switch]$Reiniciar,
  [int]$Porta = 8100,
  [int]$PortaBko = 3100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# a barra de progresso do Invoke-WebRequest no PowerShell 5.1 deixa o download dezenas de vezes mais lento
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

. (Join-Path $PSScriptRoot 'tunel.ps1')

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PastaDemo = Join-Path $Raiz '.dados\demo'
$PastaCloudflared = Join-Path $PastaDemo 'cloudflared'
$ArquivoEstado = Join-Path $PastaDemo 'processos.json'
New-Item -ItemType Directory -Force -Path $PastaDemo | Out-Null

function Passo([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "    $texto" -ForegroundColor Green }
function Aviso([string]$texto) { Write-Host "    $texto" -ForegroundColor Yellow }
function Falha([string]$texto) {
  Write-Host ''
  Write-Host "ERRO: $texto" -ForegroundColor Red
  Write-Host 'Para limpar o que já subiu: scripts\demo\derrubar-demo.ps1' -ForegroundColor Yellow
  exit 1
}

# Roda um comando externo na raiz do repositório e falha se o código de saída não for 0.
# Com -Tentativas 2, repete uma vez (ex.: deadlock passageiro no seed se outro processo usa o mesmo Postgres).
function Rodar([string]$exe, [string[]]$argumentos, [string]$descricao, [int]$Tentativas = 1) {
  Push-Location $Raiz
  try {
    for ($t = 1; $t -le $Tentativas; $t++) {
      & $exe @argumentos
      if ($LASTEXITCODE -eq 0) { return }
      if ($t -lt $Tentativas) { Aviso "$descricao falhou (código $LASTEXITCODE); tentando de novo em 5 s..."; Start-Sleep -Seconds 5 }
    }
    Falha "$descricao falhou (código $LASTEXITCODE)."
  } finally { Pop-Location }
}

# `docker info` sem barulho; no PowerShell 5.1 o stderr redirecionado de um exe vira erro com 'Stop', então troca só aqui.
function Docker-Responde {
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & docker info --format '{{.ServerVersion}}' *> $null; return ($LASTEXITCODE -eq 0) }
  catch { return $false }
  finally { $ErrorActionPreference = $antes }
}

# 200 (depois dos redirecionamentos) dentro do prazo
function Esperar-Http([string]$url, [int]$segundos) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 1500
  }
  return $false
}

# /v1/saude que se identifica como a API do Macuxi (não basta um 200 de qualquer servidor no mesmo endereço)
function Esperar-Saude([string]$url, [int]$segundos) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200 -and ($r.Content | ConvertFrom-Json).servico -eq 'macuxi-api') { return $true }
    } catch { }
    Start-Sleep -Milliseconds 1500
  }
  return $false
}

function Porta-Livre([int]$p, [string]$quem, [string]$opcao) {
  $ocupada = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($ocupada) {
    $pidDono = ($ocupada | Select-Object -First 1).OwningProcess
    Falha "A porta $p já está em uso (processo $pidDono). Feche $quem que estiver rodando (pnpm dev?) ou use $opcao."
  }
}

# Roda um comando até o fim com a saída num log (build longo e barulhento); devolve o código de saída.
function Rodar-ComLog([string]$nome, [string]$exe, [string[]]$argumentos) {
  $log = Join-Path $PastaDemo "$nome.log"
  $logErro = Join-Path $PastaDemo "$nome.erro.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $log, $logErro
  $p = Start-Process -FilePath $exe -ArgumentList $argumentos -WorkingDirectory $Raiz -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $logErro -PassThru -Wait
  return $p.ExitCode
}

function Salvar-Estado($estado) { $estado | ConvertTo-Json | Set-Content -Encoding UTF8 -Path $ArquivoEstado }

$CamposDeProcesso = @('subindo', 'api', 'worker', 'bko', 'tunel', 'tunel_bko')

# Uma demo por vez: se a registrada ainda roda (ou outra subida está em andamento), não derruba sem -Reiniciar.
if (Test-Path $ArquivoEstado) {
  $anterior = Get-Content -Raw -Path $ArquivoEstado | ConvertFrom-Json
  $vivos = @()
  foreach ($campo in $CamposDeProcesso) {
    $idAnterior = $null
    if ($anterior.PSObject.Properties.Name -contains $campo) { $idAnterior = $anterior.$campo }
    if ($idAnterior -and $idAnterior -ne $PID -and (Get-Process -Id $idAnterior -ErrorAction SilentlyContinue)) { $vivos += $campo }
  }
  if ($vivos.Count -gt 0 -and -not $Reiniciar) {
    Write-Host ''
    Write-Host 'Já há uma demonstração no ar (ou subindo) neste PC.' -ForegroundColor Yellow
    if ($anterior.PSObject.Properties.Name -contains 'url' -and $anterior.url) { Write-Host "  App (com /v1): $($anterior.url)/v1" -ForegroundColor Green }
    if ($anterior.PSObject.Properties.Name -contains 'url_bko' -and $anterior.url_bko) { Write-Host "  BKO: $($anterior.url_bko)" -ForegroundColor Green }
    Write-Host '  Para reiniciar: subir-demo.ps1 -Reiniciar   Para encerrar: derrubar-demo.ps1' -ForegroundColor Yellow
    exit 2
  }
  if ($vivos.Count -gt 0) { Aviso 'Reiniciando: derrubando a demonstração que estava no ar.' }
  & (Join-Path $PSScriptRoot 'derrubar-demo.ps1') -Silencioso
}
$estado = [ordered]@{
  iniciado_em = (Get-Date).ToUniversalTime().ToString('o'); porta = $Porta; porta_bko = $PortaBko; modo = $null
  subindo = $PID; api = $null; worker = $null; bko = $null; tunel = $null; tunel_bko = $null; url = $null; url_bko = $null
}
Salvar-Estado $estado

# ---------- 1. Docker ----------
Passo '1/7 Conferindo o Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Falha 'Docker não encontrado. Instale o Docker Desktop (https://www.docker.com/products/docker-desktop/) e rode de novo.'
}
$dockerOk = Docker-Responde
if (-not $dockerOk) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $desktop) {
    Aviso 'Docker parado: abrindo o Docker Desktop (até 2 minutos)...'
    Start-Process -FilePath $desktop | Out-Null
    $limite = (Get-Date).AddSeconds(120)
    while (-not $dockerOk -and (Get-Date) -lt $limite) {
      Start-Sleep -Seconds 3
      $dockerOk = Docker-Responde
    }
  }
}
if (-not $dockerOk) { Falha 'O Docker não respondeu. Abra o Docker Desktop, espere ficar verde e rode de novo.' }
Ok 'Docker respondendo.'

# ---------- 2. Postgres + migrações ----------
Passo '2/7 Subindo o Postgres e aplicando as migrações'
Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'subir') 'banco subir'
Ok 'Postgres no ar e migrado.'

# ---------- 3. Base de demo ----------
if ($Manter) {
  Passo '3/7 Atualizando a base de demo (upsert, sem apagar o ensaio)'
  Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'seed', 'demo') 'banco seed demo' -Tentativas 2
} else {
  Passo '3/7 Recriando a base de demo do zero'
  Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'seed', 'demo', '--recriar') 'banco seed demo --recriar' -Tentativas 2
}
Ok 'Base de demo carregada (Distribuidora Exemplo, código demo).'

# ---------- 4. API (+ worker) ----------
Passo "4/7 Subindo a API na porta $Porta"
Porta-Livre $Porta 'a API' '-Porta'
if (-not $SemBko) { Porta-Livre $PortaBko 'o BKO' '-PortaBko' }

# segredo do JWT: o do .env (lido pela própria API); sem ele, um aleatório só desta sessão (o login exige 32+)
$temSegredo = $false
if ($env:MACUXI_JWT_SEGREDO -and $env:MACUXI_JWT_SEGREDO.Length -ge 32) { $temSegredo = $true }
foreach ($arq in @((Join-Path $Raiz '.env'), (Join-Path $Raiz 'db\.env'))) {
  if (-not $temSegredo -and (Test-Path $arq)) {
    if (Select-String -Path $arq -Pattern '^\s*MACUXI_JWT_SEGREDO\s*=\s*\S{32,}' -Quiet) { $temSegredo = $true }
  }
}
$segredoTemporario = $false
if (-not $temSegredo) {
  $bytes = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:MACUXI_JWT_SEGREDO = [Convert]::ToBase64String($bytes)
  $segredoTemporario = $true
  Aviso 'MACUXI_JWT_SEGREDO não está no .env: usando um segredo aleatório só desta demo (ao derrubar, os aparelhos fazem login de novo).'
}

$env:MACUXI_API_PORTA = "$Porta"
$env:MACUXI_API_HOST = '127.0.0.1'
# o cloudflared (e o proxy do BKO) falam com a API pelo loopback: confiar nele faz req.ip = IP real do aparelho
# (X-Forwarded-For que a Cloudflare acrescenta; o proxy do Next repassa sem mexer)
$env:MACUXI_TRUST_PROXY = 'loopback'

$estado.api = Iniciar-Processo $PastaDemo 'api' 'cmd.exe' @('/c', 'pnpm', '--filter', 'api', 'start') $Raiz
Salvar-Estado $estado
if (-not (Esperar-Saude "http://127.0.0.1:$Porta/v1/saude" 90)) {
  Falha "A API não respondeu em http://127.0.0.1:$Porta/v1/saude em 90 s. Veja .dados\demo\api.log e api.erro.log."
}
Ok "API no ar: http://127.0.0.1:$Porta/v1/saude"

if (-not $SemWorker) {
  $estado.worker = Iniciar-Processo $PastaDemo 'worker' 'cmd.exe' @('/c', 'pnpm', '--filter', 'api', 'worker') $Raiz
  Salvar-Estado $estado
  Ok 'Worker da outbox iniciado (log em .dados\demo\worker.log).'
}

# ---------- 5. BKO: build ----------
# Combinado com o engenheiro-apps (R-20261101-173817): o navegador só fala com o próprio BKO; o Next repassa /api-proxy
# para a API pelo loopback (destino gravado no build). MACUXI_BKO_ORIGEM entra no next.config (origens permitidas).
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$Porta/v1"
Remove-Item -Path Env:NEXT_PUBLIC_API_MODO -ErrorAction SilentlyContinue
$env:NEXT_TELEMETRY_DISABLED = '1'
if ($SemBko) {
  Passo '5/7 BKO desligado (-SemBko)'
} else {
  Passo '5/7 Construindo o BKO (next build; 1 a 3 min)'
  $codigo = Rodar-ComLog 'bko-build' 'cmd.exe' @('/c', 'pnpm', '--filter', 'web', 'build')
  if ($codigo -ne 0) {
    Get-Content -Tail 25 -Path (Join-Path $PastaDemo 'bko-build.log') -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Falha "next build do BKO falhou (código $codigo). Veja .dados\demo\bko-build.log e bko-build.erro.log."
  }
  Ok 'BKO construído.'
}

# ---------- 6. Túnel HTTPS ----------
$urlApi = $null
$urlBko = $null
$exeCf = $null
if ($SemTunel) {
  Passo '6/7 Túnel desligado (-SemTunel)'
} else {
  Passo '6/7 Abrindo o túnel HTTPS (cloudflared)'
  try { $exeCf = Garantir-Cloudflared (Join-Path $PastaDemo 'bin\cloudflared.exe') -SoPortatil:$Portatil }
  catch { Falha $_.Exception.Message }
  Ok "cloudflared: $exeCf"

  # nomeado (domínio fixo) se configurado e conectado; senão o rápido, com aviso (tunel.ps1, Abrir-TunelDemo)
  $t = Abrir-TunelDemo $exeCf $PastaDemo $PastaCloudflared $Porta $PortaBko $Raiz -Rapido:$TunelRapido
  if (-not $t) { Falha 'O cloudflared não informou o endereço em 3 min. Veja .dados\demo\tunel-rapido.erro.log (internet? firewall?).' }
  $estado.tunel = $t.Pid; $estado.modo = $t.Modo; $urlApi = $t.Api; $urlBko = $t.Bko
  Salvar-Estado $estado
  if ($t.Modo -eq 'nomeado') { Ok "Conectado: $urlApi e $urlBko" } else { Ok "API: $urlApi (endereço temporário)" }
}

# ---------- 7. BKO no ar + conferência ----------
if (-not $SemBko) {
  if ($estado.modo -eq 'rapido') {
    $t = Abrir-TunelRapido $exeCf $PastaDemo 'tunel-rapido-bko' $PortaBko $Raiz 180
    if ($t) { $estado.tunel_bko = $t.Pid; $urlBko = $t.Url } else { Aviso 'O túnel rápido do BKO não abriu (veja .dados\demo\tunel-rapido-bko.erro.log): o BKO fica só no PC.' }
  }
  $env:MACUXI_BKO_ORIGEM = if ($urlBko) { $urlBko } else { "http://127.0.0.1:$PortaBko" }
  Passo "7/7 Subindo o BKO na porta $PortaBko e conferindo"
  $estado.bko = Iniciar-Processo $PastaDemo 'bko' 'cmd.exe' @('/c', 'pnpm', '--filter', 'web', 'exec', 'next', 'start', '-p', "$PortaBko", '-H', '127.0.0.1') $Raiz
  Salvar-Estado $estado
  if (-not (Esperar-Http "http://127.0.0.1:$PortaBko/login" 90)) {
    Falha "O BKO não respondeu em http://127.0.0.1:$PortaBko/login em 90 s. Veja .dados\demo\bko.log e bko.erro.log."
  }
  if (-not (Esperar-Saude "http://127.0.0.1:$PortaBko/api-proxy/saude" 30)) {
    Falha "O BKO subiu, mas o proxy dele não chega à API (http://127.0.0.1:$PortaBko/api-proxy/saude). Veja .dados\demo\bko.log."
  }
  Ok "BKO no ar: http://127.0.0.1:$PortaBko (proxy /api-proxy -> API ok)"
} else {
  Passo '7/7 Conferindo'
}
$estado.url = $urlApi
$estado.url_bko = $urlBko
$estado.subindo = $null
Salvar-Estado $estado

# conferência pelos endereços públicos (o que o celular e o navegador vão usar)
$pendencias = @()
if ($urlApi) {
  if (Esperar-Saude "$urlApi/v1/saude" 90) { Ok "API pela internet: $urlApi/v1/saude" }
  else { $pendencias += "$urlApi/v1/saude não respondeu daqui (DNS deste PC? internet?)" }
}
if ($urlBko) {
  if (Esperar-Http "$urlBko/login" 60) { Ok "BKO pela internet: $urlBko" }
  else { $pendencias += "$urlBko não respondeu daqui" }
}

# ---------- Resumo ----------
$senha = 'demo-macuxi'
$senhaPorVariavel = [bool]$env:MACUXI_SENHA_DEMO
foreach ($arq in @((Join-Path $Raiz '.env'), (Join-Path $Raiz 'db\.env'))) {
  if (-not $senhaPorVariavel -and (Test-Path $arq)) {
    if (Select-String -Path $arq -Pattern '^\s*MACUXI_SENHA_DEMO\s*=\s*\S' -Quiet) { $senhaPorVariavel = $true }
  }
}
if ($senhaPorVariavel) { $senha = '(a de MACUXI_SENHA_DEMO no .env)' }

Write-Host ''
if ($pendencias.Count -eq 0) {
  Write-Host '==> Pronto para a demonstração' -ForegroundColor Green
} else {
  Write-Host '==> No ar, mas SEM confirmação pelo endereço público:' -ForegroundColor Red
  foreach ($p in $pendencias) { Write-Host "    - $p" -ForegroundColor Red }
  Write-Host '    Teste no celular antes de começar. Os processos continuam rodando.' -ForegroundColor Yellow
}
Write-Host ''
if ($estado.modo -eq 'nomeado') {
  Write-Host "  App:  $urlApi/v1   (já vem nos APKs de preview; não precisa digitar)" -ForegroundColor Green
  if ($urlBko) { Write-Host "  BKO:  $urlBko" -ForegroundColor Green }
} elseif ($estado.modo -eq 'rapido') {
  $enderecoApp = "$urlApi/v1"
  Write-Host '  ATENÇÃO: túnel rápido, endereço temporário (muda a cada subida).' -ForegroundColor Yellow
  Write-Host "  Os APKs de preview usam https://$DemoHostApi/v1 e NÃO conectam por ele: use o build de desenvolvimento" -ForegroundColor Yellow
  Write-Host '  (login > Avançado > Servidor) e digite exatamente, com /v1:' -ForegroundColor Yellow
  Write-Host "      $enderecoApp" -ForegroundColor Green
  try {
    Set-Clipboard -Value $enderecoApp -ErrorAction Stop
    Write-Host '      (copiado para a área de transferência)' -ForegroundColor DarkGray
  } catch {
    Write-Host '      (não deu para copiar para a área de transferência: copie da linha acima)' -ForegroundColor DarkGray
  }
  if ($urlBko) { Write-Host "  BKO:  $urlBko" -ForegroundColor Green }
} else {
  Write-Host "  API local: http://127.0.0.1:$Porta/v1 (sem túnel)" -ForegroundColor White
  if (-not $SemBko) { Write-Host "  BKO local: http://127.0.0.1:$PortaBko" -ForegroundColor White }
}
Write-Host ''
Write-Host '  Código da empresa: demo' -ForegroundColor White
Write-Host "  Senha de todos:    $senha" -ForegroundColor White
Write-Host ''
Write-Host '  Macuxi Campo'
Write-Host '    vendedor@exemplo.com.br     Lucas Andrade (vendedor, rota de hoje com 6 paradas)'
Write-Host '    vendedor2@exemplo.com.br    Camila Freitas (vendedora, 4 paradas)'
Write-Host '    promotor@exemplo.com.br     Joana Prado (promotora, 4 paradas, sem pedido)'
Write-Host '  Macuxi Gestão'
Write-Host '    supervisor@exemplo.com.br   Renata Barros (Equipe Manaus, 2 pedidos para aprovar)'
Write-Host '  BKO e outros perfis'
Write-Host '    analista@exemplo.com.br     analista'
Write-Host '    admin@exemplo.com.br        administrador'
Write-Host ''
if ($segredoTemporario) { Aviso 'Segredo do JWT temporário (sem MACUXI_JWT_SEGREDO no .env).' }
Write-Host '  Logs: .dados\demo\   Para encerrar: scripts\demo\derrubar-demo.ps1' -ForegroundColor DarkGray
if ($pendencias.Count -gt 0) { exit 3 }
