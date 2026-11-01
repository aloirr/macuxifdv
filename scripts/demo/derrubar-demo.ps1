<#
.SYNOPSIS
  Derruba a demonstração do Macuxi FDV (T-0026): túnel, worker e API que o subir-demo.ps1 iniciou.

.DESCRIPTION
  Lê .dados\demo\processos.json e encerra cada processo com a árvore de filhos (taskkill /T).
  O Postgres continua no ar (é o mesmo do desenvolvimento) e a base de demo fica como estava;
  -PararBanco também para o container (banco derrubar, sem apagar dados).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1
  powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1 -PararBanco
#>
[CmdletBinding()]
param(
  [switch]$PararBanco,
  # Usado pelo subir-demo.ps1 antes de subir de novo: menos mensagens.
  [switch]$Silencioso,
  # Porta da API quando não há processos.json (a registrada vale mais).
  [int]$Porta = 8100
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

$estado = $null
if (Test-Path $ArquivoEstado) {
  $estado = Get-Content -Raw -Path $ArquivoEstado | ConvertFrom-Json
  if (-not $Silencioso) { Write-Host '==> Encerrando a demonstração' -ForegroundColor Cyan }
  # túnel primeiro: ninguém de fora chega na API enquanto ela cai
  Encerrar 'túnel (cloudflared)' $estado.tunel
  Encerrar 'worker' $estado.worker
  Encerrar 'API' $estado.api
  Remove-Item -Force -Path $ArquivoEstado
} elseif (-not $Silencioso) {
  Write-Host 'Nenhuma demo registrada em .dados\demo\processos.json (já estava derrubada?).' -ForegroundColor Yellow
}

# sobra: se o cmd.exe pai morreu antes (janela fechada), o node fica órfão e o taskkill /T não o alcança.
# API: quem escuta a porta da demo; worker: o 'tsx src/worker.ts' sem watch (o pnpm dev usa 'tsx watch').
$porta = $Porta
if ($estado -and $estado.PSObject.Properties.Name -contains 'porta' -and $estado.porta) { $porta = [int]$estado.porta }
$escuta = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($escuta) {
  $dono = Get-CimInstance Win32_Process -Filter "ProcessId = $($escuta.OwningProcess)" -ErrorAction SilentlyContinue
  if ($dono -and $dono.CommandLine -match 'servidor\.ts') { Encerrar "API órfã na porta $porta" $dono.ProcessId }
}
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
