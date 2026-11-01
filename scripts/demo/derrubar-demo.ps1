<#
.SYNOPSIS
  Derruba a demonstração do Macuxi FDV (T-0026, T-0038): túnel(is), worker, API e BKO que o subir-demo.ps1 iniciou.

.DESCRIPTION
  Lê .dados\demo\processos.json e encerra cada processo com a árvore de filhos (taskkill /T), túnel primeiro.
  O Postgres continua no ar (é o mesmo do desenvolvimento) e a base de demo fica como estava;
  -PararBanco também para o container (banco derrubar, sem apagar dados).
  O túnel nomeado e o DNS (configurar-dominio.ps1) continuam configurados: só o processo do cloudflared é encerrado.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1
  powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1 -PararBanco
#>
[CmdletBinding()]
param(
  [switch]$PararBanco,
  # Usado pelo subir-demo.ps1 antes de subir de novo: menos mensagens.
  [switch]$Silencioso,
  # Portas da API e do BKO quando não há processos.json (as registradas valem mais).
  [int]$Porta = 8100,
  [int]$PortaBko = 3100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArquivoEstado = Join-Path $Raiz '.dados\demo\processos.json'

function Encerrar([string]$nome, $id) {
  if (-not $id) { return }
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p) {
    if (-not $Silencioso) { Write-Host "    $nome (PID $id) já tinha parado." -ForegroundColor DarkGray }
    return
  }
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & taskkill.exe /PID $id /T /F *> $null } finally { $ErrorActionPreference = $antes }
  Write-Host "    $nome (PID $id) encerrado." -ForegroundColor Green
}

function Campo($obj, [string]$nome) {
  if ($obj -and $obj.PSObject.Properties.Name -contains $nome) { return $obj.$nome }
  return $null
}

$estado = $null
if (Test-Path $ArquivoEstado) {
  $estado = Get-Content -Raw -Path $ArquivoEstado | ConvertFrom-Json
  if (-not $Silencioso) { Write-Host '==> Encerrando a demonstração' -ForegroundColor Cyan }
  # túneis primeiro: ninguém de fora chega na API nem no BKO enquanto eles caem
  Encerrar 'túnel (cloudflared)' (Campo $estado 'tunel')
  Encerrar 'túnel do BKO (cloudflared)' (Campo $estado 'tunel_bko')
  Encerrar 'BKO' (Campo $estado 'bko')
  Encerrar 'worker' (Campo $estado 'worker')
  Encerrar 'API' (Campo $estado 'api')
  Remove-Item -Force -Path $ArquivoEstado
} elseif (-not $Silencioso) {
  Write-Host 'Nenhuma demo registrada em .dados\demo\processos.json (já estava derrubada?).' -ForegroundColor Yellow
}

# sobra: se o cmd.exe pai morreu antes (janela fechada), o node fica órfão e o taskkill /T não o alcança.
# API: quem escuta a porta da demo rodando servidor.ts; BKO: quem escuta a porta do BKO rodando `next start`;
# worker: o 'tsx src/worker.ts' sem watch (o pnpm dev usa 'tsx watch').
$porta = $Porta
if (Campo $estado 'porta') { $porta = [int](Campo $estado 'porta') }
$portaBko = $PortaBko
if (Campo $estado 'porta_bko') { $portaBko = [int](Campo $estado 'porta_bko') }
function Orfao-NaPorta([int]$p, [string]$padrao, [string]$nome) {
  $escuta = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $escuta) { return }
  $dono = Get-CimInstance Win32_Process -Filter "ProcessId = $($escuta.OwningProcess)" -ErrorAction SilentlyContinue
  if ($dono -and $dono.CommandLine -match $padrao) { Encerrar "$nome órfão na porta $p" $dono.ProcessId }
}
# cloudflared órfão da demo (túnel aberto expõe o PC): o nomeado pelo config.yml da demo, o rápido pela porta
$tuneisOrfaos = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '\.dados[\\/]demo[\\/]cloudflared[\\/]config\.yml' -or $_.CommandLine -match "--url\s+`"?http://127\.0\.0\.1:($porta|$portaBko)(\D|$)" }
foreach ($o in @($tuneisOrfaos)) { if ($o) { Encerrar 'túnel órfão (cloudflared)' $o.ProcessId } }
Orfao-NaPorta $porta 'servidor\.ts' 'API'
Orfao-NaPorta $portaBko 'next.*\sstart\b' 'BKO'
$orfaos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'tsx[\\/]dist[\\/]cli\.mjs"?\s+src[\\/]worker\.ts' -and $_.CommandLine -notmatch '\swatch\s' }
foreach ($o in @($orfaos)) { if ($o) { Encerrar 'worker órfão' $o.ProcessId } }

if ($PararBanco) {
  Write-Host '==> Parando o Postgres (os dados ficam no volume)' -ForegroundColor Cyan
  Push-Location $Raiz
  try {
    & pnpm --filter '@macuxi/db' banco derrubar
    if ($LASTEXITCODE -ne 0) { Write-Host "banco derrubar falhou (código $LASTEXITCODE)." -ForegroundColor Red; exit 1 }
  } finally { Pop-Location }
}

if (-not $Silencioso) { Write-Host 'Demo derrubada.' -ForegroundColor Green }
