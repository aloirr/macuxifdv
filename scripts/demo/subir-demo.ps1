<#
.SYNOPSIS
  Sobe a demonstração do Macuxi FDV (T-0026): Postgres + migrações, base de demo, API (+ worker) e túnel HTTPS.

.DESCRIPTION
  1. confere o Docker (tenta abrir o Docker Desktop se estiver parado);
  2. sobe o Postgres (db/docker-compose.yml) e aplica as migrações (banco subir);
  3. carrega a base de demo (banco seed demo --recriar; com -Manter, upsert sem apagar o que o app gravou);
  4. sobe a API (porta 8100) e o worker da outbox, com MACUXI_TRUST_PROXY=loopback (limite de login por aparelho);
  5. abre o túnel HTTPS (cloudflared tunnel --url), instalando o cloudflared com winget se faltar;
  6. imprime o endereço https para digitar no app e os logins.
  Para parar: scripts\demo\derrubar-demo.ps1. Processos e logs ficam em .dados\demo\ (fora do git).

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
  # Não abre o túnel (só API local, ex.: emulador ou aparelho na mesma rede).
  [switch]$SemTunel,
  # Sem winget/administrador: usa (ou baixa) o cloudflared portátil em .dados\demoin.
  [switch]$Portatil,
  # Derruba a demo que estiver no ar e sobe de novo (sem isso, o script recusa para não derrubar a de outra janela).
  [switch]$Reiniciar,
  [int]$Porta = 8100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# a barra de progresso do Invoke-WebRequest no PowerShell 5.1 deixa o download dezenas de vezes mais lento
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PastaDemo = Join-Path $Raiz '.dados\demo'
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

function Esperar-Http([string]$url, [int]$segundos) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 1500
  }
  return $false
}

# Sobe um processo em segundo plano (janela oculta) com saída num arquivo de log; devolve o PID.
function Iniciar([string]$nome, [string]$exe, [string[]]$argumentos) {
  $log = Join-Path $PastaDemo "$nome.log"
  $logErro = Join-Path $PastaDemo "$nome.erro.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $log, $logErro
  $p = Start-Process -FilePath $exe -ArgumentList $argumentos -WorkingDirectory $Raiz -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $logErro -PassThru
  return $p.Id
}

$CloudflaredPortatil = Join-Path $PastaDemo 'bin\cloudflared.exe'

# cloudflared no PATH, nos lugares do instalador/winget ou o portátil baixado antes; $null se não houver
function Achar-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $candidatos = @(
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'),
    $CloudflaredPortatil
  )
  foreach ($x in $candidatos) { if (Test-Path $x) { return $x } }
  return $null
}

function Salvar-Estado($estado) { $estado | ConvertTo-Json | Set-Content -Encoding UTF8 -Path $ArquivoEstado }

# Uma demo por vez: se a registrada ainda roda (ou outra subida está em andamento), não derruba sem -Reiniciar.
if (Test-Path $ArquivoEstado) {
  $anterior = Get-Content -Raw -Path $ArquivoEstado | ConvertFrom-Json
  $vivos = @()
  foreach ($campo in @('subindo', 'api', 'worker', 'tunel')) {
    $idAnterior = $null
    if ($anterior.PSObject.Properties.Name -contains $campo) { $idAnterior = $anterior.$campo }
    if ($idAnterior -and $idAnterior -ne $PID -and (Get-Process -Id $idAnterior -ErrorAction SilentlyContinue)) { $vivos += $campo }
  }
  if ($vivos.Count -gt 0 -and -not $Reiniciar) {
    Write-Host ''
    Write-Host 'Já há uma demonstração no ar (ou subindo) neste PC.' -ForegroundColor Yellow
    if ($anterior.url) { Write-Host "  Endereço atual: $($anterior.url)" -ForegroundColor Green }
    Write-Host '  Para reiniciar (o endereço muda): subir-demo.ps1 -Reiniciar   Para encerrar: derrubar-demo.ps1' -ForegroundColor Yellow
    exit 2
  }
  if ($vivos.Count -gt 0) { Aviso 'Reiniciando: derrubando a demonstração que estava no ar.' }
  & (Join-Path $PSScriptRoot 'derrubar-demo.ps1') -Silencioso
}
$estado = [ordered]@{ iniciado_em = (Get-Date).ToUniversalTime().ToString('o'); porta = $Porta; subindo = $PID; api = $null; worker = $null; tunel = $null; url = $null }
Salvar-Estado $estado

# ---------- 1. Docker ----------
Passo '1/6 Conferindo o Docker'
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
Passo '2/6 Subindo o Postgres e aplicando as migrações'
Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'subir') 'banco subir'
Ok 'Postgres no ar e migrado.'

# ---------- 3. Base de demo ----------
if ($Manter) {
  Passo '3/6 Atualizando a base de demo (upsert, sem apagar o ensaio)'
  Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'seed', 'demo') 'banco seed demo' -Tentativas 2
} else {
  Passo '3/6 Recriando a base de demo do zero'
  Rodar 'pnpm' @('--filter', '@macuxi/db', 'banco', 'seed', 'demo', '--recriar') 'banco seed demo --recriar' -Tentativas 2
}
Ok 'Base de demo carregada (Distribuidora Exemplo, código demo).'

# ---------- 4. API (+ worker) ----------
Passo "4/6 Subindo a API na porta $Porta"
$ocupada = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue
if ($ocupada) {
  $pidDono = ($ocupada | Select-Object -First 1).OwningProcess
  Falha "A porta $Porta já está em uso (processo $pidDono). Feche a API que estiver rodando (pnpm dev?) ou use -Porta."
}

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
# o cloudflared fala com a API pelo loopback: confiar nele faz req.ip = IP real do aparelho (X-Forwarded-For)
$env:MACUXI_TRUST_PROXY = 'loopback'

$estado.api = Iniciar 'api' 'cmd.exe' @('/c', 'pnpm', '--filter', 'api', 'start')
Salvar-Estado $estado
if (-not (Esperar-Http "http://127.0.0.1:$Porta/v1/saude" 90)) {
  Falha "A API não respondeu em http://127.0.0.1:$Porta/v1/saude em 90 s. Veja .dados\demo\api.log e api.erro.log."
}
Ok "API no ar: http://127.0.0.1:$Porta/v1/saude"

if (-not $SemWorker) {
  $estado.worker = Iniciar 'worker' 'cmd.exe' @('/c', 'pnpm', '--filter', 'api', 'worker')
  Salvar-Estado $estado
  Ok 'Worker da outbox iniciado (log em .dados\demo\worker.log).'
}

# ---------- 5. Túnel HTTPS ----------
$urlPublica = $null
if ($SemTunel) {
  Passo '5/6 Túnel desligado (-SemTunel)'
} else {
  Passo '5/6 Abrindo o túnel HTTPS (cloudflared)'
  $exeCf = Achar-Cloudflared
  if (-not $exeCf) {
    if (-not $Portatil -and (Get-Command winget -ErrorAction SilentlyContinue)) {
      Aviso 'cloudflared não encontrado: instalando com winget (Cloudflare.cloudflared; o Windows pede para autorizar)...'
      $antes = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try { & winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --disable-interactivity }
      finally { $ErrorActionPreference = $antes }
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $exeCf = Achar-Cloudflared
    }
  }
  if (-not $exeCf) {
    # sem winget ou sem permissão de administrador (o instalador MSI pede elevação): executável portátil oficial,
    # só para este usuário, em .dados\demo\bin, conferindo a assinatura digital da Cloudflare antes de usar
    Aviso 'Instalação pelo winget não concluída: baixando o cloudflared portátil (release oficial no GitHub)...'
    New-Item -ItemType Directory -Force -Path (Split-Path $CloudflaredPortatil) | Out-Null
    $temp = Join-Path (Split-Path $CloudflaredPortatil) 'cloudflared-baixando.exe'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $temp
    } catch { Falha "Não consegui baixar o cloudflared ($($_.Exception.Message)). Instale manualmente: winget install Cloudflare.cloudflared" }
    $assinatura = Get-AuthenticodeSignature -FilePath $temp
    if ($assinatura.Status -ne 'Valid' -or $assinatura.SignerCertificate.Subject -notmatch 'Cloudflare') {
      Remove-Item -Force $temp
      Falha "O cloudflared baixado não tem assinatura válida da Cloudflare ($($assinatura.Status)). Instale manualmente: winget install Cloudflare.cloudflared"
    }
    Move-Item -Force $temp $CloudflaredPortatil
    $exeCf = $CloudflaredPortatil
  }
  Ok "cloudflared: $exeCf"
  $estado.tunel = Iniciar 'tunel' $exeCf @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Porta")
  Salvar-Estado $estado

  # o cloudflared escreve o endereço (https://<nome>.trycloudflare.com) no stderr
  $logTunel = Join-Path $PastaDemo 'tunel.erro.log'
  # a 1ª execução do cloudflared pode levar mais de 1 min para escrever (antivírus examinando o exe novo)
  $limite = (Get-Date).AddSeconds(180)
  while (-not $urlPublica -and (Get-Date) -lt $limite) {
    Start-Sleep -Seconds 1
    if (Test-Path $logTunel) {
      $m = Select-String -Path $logTunel -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
      if ($m) { $urlPublica = $m.Matches[0].Value }
    }
    if (-not (Get-Process -Id $estado.tunel -ErrorAction SilentlyContinue)) { break }
  }
  if (-not $urlPublica) { Falha 'O cloudflared não informou o endereço em 3 min. Veja .dados\demo\tunel.erro.log (internet? firewall?).' }
  $estado.url = $urlPublica
  Salvar-Estado $estado

  # o nome novo leva alguns segundos para propagar no DNS
  if (Esperar-Http "$urlPublica/v1/saude" 90) {
    Ok "Túnel respondendo: $urlPublica/v1/saude"
  } else {
    Aviso "O túnel abriu ($urlPublica), mas /v1/saude ainda não respondeu daqui (DNS do PC?). Teste no celular antes de começar."
  }
}

$estado.subindo = $null
Salvar-Estado $estado

# ---------- 6. Resumo ----------
Passo '6/6 Pronto para a demonstração'
$senha = 'demo-macuxi'
$senhaPorVariavel = [bool]$env:MACUXI_SENHA_DEMO
foreach ($arq in @((Join-Path $Raiz '.env'), (Join-Path $Raiz 'db\.env'))) {
  if (-not $senhaPorVariavel -and (Test-Path $arq)) {
    if (Select-String -Path $arq -Pattern '^\s*MACUXI_SENHA_DEMO\s*=\s*\S' -Quiet) { $senhaPorVariavel = $true }
  }
}
if ($senhaPorVariavel) { $senha = '(a de MACUXI_SENHA_DEMO no .env)' }

Write-Host ''
if ($urlPublica) {
  Write-Host '  Endereço do servidor (digite no app, em "Servidor" na tela de login, e toque em "Testar e salvar"):' -ForegroundColor White
  Write-Host "      $urlPublica" -ForegroundColor Green
} else {
  Write-Host "  API local: http://127.0.0.1:$Porta (sem túnel)" -ForegroundColor White
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
Write-Host '  Outros perfis'
Write-Host '    analista@exemplo.com.br     analista'
Write-Host '    admin@exemplo.com.br        administrador'
Write-Host ''
if ($segredoTemporario) { Aviso 'Segredo do JWT temporário (sem MACUXI_JWT_SEGREDO no .env).' }
Write-Host '  Logs: .dados\demo\   Para encerrar: scripts\demo\derrubar-demo.ps1' -ForegroundColor DarkGray
Write-Host '  O endereço muda a cada subida: digite o novo no app.' -ForegroundColor DarkGray
