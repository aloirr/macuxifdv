<#
.SYNOPSIS
  Testes do tunel.ps1 e do configurar-dominio.ps1 (T-0038) com um cloudflared simulado (cloudflared-simulado.cmd).

.DESCRIPTION
  Nada aqui fala com a Cloudflare nem lê %USERPROFILE%\.cloudflared ou .env: o MACUXI_CLOUDFLARED aponta para o
  simulado, que devolve o JSON de exemplo preparado em uma pasta temporária. Roda no PowerShell 5.1 e no 7:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\teste\tunel.test.ps1
    pwsh -NoProfile -File scripts\demo\teste\tunel.test.ps1
  Sai com código 0 se tudo passou e 1 se algum caso falhou.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Demo = Split-Path $PSScriptRoot
. (Join-Path $Demo 'tunel.ps1')

$Simulado = Join-Path $PSScriptRoot 'cloudflared-simulado.cmd'
$Shell = (Get-Process -Id $PID).Path
$Base = Join-Path ([IO.Path]::GetTempPath()) ("macuxi-tunel-teste-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Base | Out-Null
$script:falhas = 0
$script:casos = 0

function Caso([string]$Nome, [scriptblock]$Corpo) {
  $script:casos++
  try { & $Corpo; Write-Host "  ok   $Nome" -ForegroundColor Green }
  catch { $script:falhas++; Write-Host "  FALHA $Nome`n        $($_.Exception.Message)" -ForegroundColor Red }
}
function Esperar($Condicao, [string]$Mensagem) { if (-not $Condicao) { throw $Mensagem } }

function Gravar([string]$Caminho, [string]$Texto) {
  [IO.File]::WriteAllText($Caminho, $Texto, (New-Object Text.UTF8Encoding($false)))
}

# Pasta nova do simulado para cada caso; devolve o caminho.
function Nova-Pasta([string]$Nome) {
  $p = Join-Path $Base $Nome
  New-Item -ItemType Directory -Force -Path $p | Out-Null
  return $p
}

# Saída real do `cloudflared tunnel list --output json --name macuxi-demo` (formato do cloudflared 2024+; ids de exemplo).
$Id = '3f1c2b7a-9d4e-4b8a-a6c1-0e5d7f2a9b13'
$JsonAtivoZero = '[{"id":"' + $Id + '","name":"macuxi-demo","created_at":"2026-11-01T22:58:41.512304Z","deleted_at":"0001-01-01T00:00:00Z","connections":[]}]'
$JsonApagado = '[{"id":"' + $Id + '","name":"macuxi-demo","created_at":"2026-10-20T13:02:11.004Z","deleted_at":"2026-10-21T09:15:00.731Z","connections":[]}]'
$JsonSemCampo = '[{"id":"' + $Id + '","name":"macuxi-demo","created_at":"2026-11-01T22:58:41.512304Z","connections":[]}]'
# o mesmo túnel ativo, indentado e com conexão (como aparece com o túnel rodando)
$JsonAtivoIndentado = @"
[
  {
    "id": "$Id",
    "name": "macuxi-demo",
    "created_at": "2026-11-01T22:58:41.512304Z",
    "deleted_at": "0001-01-01T00:00:00Z",
    "connections": [
      {
        "colo_name": "gru01",
        "id": "9b8d7c6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e",
        "is_pending_reconnect": false,
        "origin_ip": "203.0.113.10",
        "opened_at": "2026-11-01T23:02:05.118Z"
      }
    ]
  }
]
"@

function Listar-ComJson([string]$Json, [string]$Pasta) {
  Gravar (Join-Path $Pasta 'list.json') $Json
  $env:MACUXI_SIMULADO_DIR = $Pasta
  return @(Listar-Tuneis $Simulado 'macuxi-demo')
}

Write-Host "Testes do tunel.ps1 (PowerShell $($PSVersionTable.PSVersion))" -ForegroundColor Cyan

# ---------- Tunel-Apagado (regra do deleted_at) ----------
Caso 'deleted_at "0001-01-01T00:00:00Z" (tempo zero do Go) = ativo' {
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ name = 'macuxi-demo'; deleted_at = '0001-01-01T00:00:00Z' }))) 'tratou o tempo zero como apagado'
}
Caso 'deleted_at DateTime do ano 1 (PowerShell 7 converte a string) = ativo' {
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ deleted_at = [datetime]::MinValue }))) 'DateTime.MinValue tratado como apagado'
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ deleted_at = [datetimeoffset]::MinValue }))) 'DateTimeOffset.MinValue tratado como apagado'
  $local = ([datetime]::SpecifyKind([datetime]::MinValue, 'Utc')).ToLocalTime()
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ deleted_at = $local }))) 'ano 1 convertido para hora local tratado como apagado'
}
Caso 'deleted_at com data real = apagado (string e DateTime)' {
  Esperar (Tunel-Apagado ([pscustomobject]@{ deleted_at = '2026-10-21T09:15:00.731Z' })) 'data real em string não contou como apagado'
  Esperar (Tunel-Apagado ([pscustomobject]@{ deleted_at = [datetime]::new(2026, 10, 21, 9, 15, 0, [DateTimeKind]::Utc) })) 'data real em DateTime não contou como apagado'
}
Caso 'sem deleted_at, nulo ou vazio = ativo' {
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ name = 'macuxi-demo' }))) 'sem o campo contou como apagado'
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ deleted_at = $null }))) 'nulo contou como apagado'
  Esperar (-not (Tunel-Apagado ([pscustomobject]@{ deleted_at = '' }))) 'vazio contou como apagado'
}

# ---------- Listar-Tuneis com a saída JSON do cloudflared (simulado) ----------
Caso 'lista: deleted_at zero = túnel ativo encontrado' {
  $t = @(Listar-ComJson $JsonAtivoZero (Nova-Pasta 'lista-zero'))
  Esperar ($t.Count -eq 1) "esperava 1 túnel, veio $($t.Count)"
  Esperar ([string]$t[0].id -eq $Id) "id errado: $($t[0].id)"
}
Caso 'lista: deleted_at zero, JSON indentado e com conexão = ativo' {
  $t = @(Listar-ComJson $JsonAtivoIndentado (Nova-Pasta 'lista-indentado'))
  Esperar ($t.Count -eq 1) "esperava 1 túnel, veio $($t.Count)"
}
Caso 'lista: deleted_at com data real = apagado (fora da lista)' {
  $t = @(Listar-ComJson $JsonApagado (Nova-Pasta 'lista-apagado'))
  Esperar ($t.Count -eq 0) "esperava 0 túnel, veio $($t.Count)"
}
Caso 'lista: sem o campo deleted_at = ativo' {
  $t = @(Listar-ComJson $JsonSemCampo (Nova-Pasta 'lista-sem-campo'))
  Esperar ($t.Count -eq 1) "esperava 1 túnel, veio $($t.Count)"
}
Caso 'lista: vazia ("[]" e "null") e outro nome = nada' {
  Esperar (@(Listar-ComJson '[]' (Nova-Pasta 'lista-vazia')).Count -eq 0) '[] trouxe túnel'
  Esperar (@(Listar-ComJson 'null' (Nova-Pasta 'lista-null')).Count -eq 0) 'null trouxe túnel'
  $outro = $JsonAtivoZero -replace '"macuxi-demo"', '"outro-tunel"'
  Esperar (@(Listar-ComJson $outro (Nova-Pasta 'lista-outro')).Count -eq 0) 'túnel de outro nome entrou'
}

# ---------- configurar-dominio.ps1 de ponta a ponta (simulado) ----------
# Roda o script num processo novo (mesmo PowerShell deste teste). Devolve { Codigo; Saida; Chamadas; PastaConfig }.
function Rodar-Configurar([string]$Pasta) {
  $pastaConfig = Join-Path $Pasta 'config'
  $env:MACUXI_SIMULADO_DIR = $Pasta
  $env:MACUXI_CLOUDFLARED = $Simulado
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $saida = & $Shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Demo 'configurar-dominio.ps1') -PastaConfig $pastaConfig -EuSeiQueTiraAVmDoAr 2>&1 | Out-String
    $codigo = $LASTEXITCODE
  } finally { $ErrorActionPreference = $antes; Remove-Item Env:\MACUXI_CLOUDFLARED -ErrorAction SilentlyContinue }
  $log = Join-Path $Pasta 'chamadas.log'
  $chamadas = @(); if (Test-Path $log) { $chamadas = @(Get-Content -Path $log) }
  return [pscustomobject]@{ Codigo = $codigo; Saida = $saida; Chamadas = $chamadas; PastaConfig = $pastaConfig }
}

Caso 'configurar: túnel já existente (deleted_at zero) é reaproveitado, sem tunnel create' {
  $p = Nova-Pasta 'conf-existente'
  Gravar (Join-Path $p 'list.json') $JsonAtivoZero
  $r = Rodar-Configurar $p
  Esperar ($r.Codigo -eq 0) "código $($r.Codigo); saída:`n$($r.Saida)"
  Esperar ($r.Saida -match 'reaproveitado') "sem 'reaproveitado' na saída:`n$($r.Saida)"
  Esperar (-not ($r.Chamadas | Where-Object { $_ -match '^tunnel create' })) "chamou tunnel create: $($r.Chamadas -join ' | ')"
  Esperar (@($r.Chamadas | Where-Object { $_ -match "^tunnel route dns $Id " }).Count -eq 2) "route dns sem o id do túnel: $($r.Chamadas -join ' | ')"
  $marcador = Get-Content -Raw (Join-Path $r.PastaConfig 'tunel.json') | ConvertFrom-Json
  Esperar ($marcador.id -eq $Id) "marcador com id $($marcador.id)"
  Esperar ((Get-Content -Raw (Join-Path $r.PastaConfig 'config.yml')) -match "tunnel: $Id") 'config.yml sem o id do túnel'
}
Caso 'configurar: create diz "already exists" e a lista não acha = erro claro, sem mandar esperar' {
  $p = Nova-Pasta 'conf-ja-existe'
  Gravar (Join-Path $p 'list.json') '[]'
  Gravar (Join-Path $p 'create.erro') 'failed to create tunnel: Create Tunnel API call failed: tunnel with name already exists'
  $r = Rodar-Configurar $p
  Esperar ($r.Codigo -eq 1) "código $($r.Codigo) (esperava 1)"
  Esperar ($r.Saida -match 'EXISTE' -and $r.Saida -match 'already exists') "mensagem sem 'já existe':`n$($r.Saida)"
  Esperar ($r.Saida -notmatch '1 minuto') "ainda manda esperar 1 minuto:`n$($r.Saida)"
  Esperar (@($r.Chamadas | Where-Object { $_ -match '^tunnel create' }).Count -eq 1) 'tentou criar mais de uma vez'
}
Caso 'configurar: create diz "already exists" e a lista acha = reaproveitado' {
  $p = Nova-Pasta 'conf-ja-existe-lista'
  # 1ª lista vazia; o create responde "already exists" e a lista seguinte já mostra o túnel
  Gravar (Join-Path $p 'list.json') '[]'
  Gravar (Join-Path $p 'create.erro') 'failed to create tunnel: Create Tunnel API call failed: tunnel with name already exists'
  Gravar (Join-Path $p 'list-apos-create.json') $JsonAtivoZero
  $r = Rodar-Configurar $p
  Esperar ($r.Codigo -eq 0) "código $($r.Codigo); saída:`n$($r.Saida)"
  Esperar ($r.Saida -match "Já existia \(id $Id\): reaproveitado") "sem 'Já existia ... reaproveitado':`n$($r.Saida)"
}
Caso 'configurar: túnel novo é criado e achado na lista' {
  $p = Nova-Pasta 'conf-novo'
  Gravar (Join-Path $p 'list-apos-create.json') $JsonAtivoZero
  $r = Rodar-Configurar $p
  Esperar ($r.Codigo -eq 0) "código $($r.Codigo); saída:`n$($r.Saida)"
  Esperar ($r.Saida -match "Criado \(id $Id\)") "sem 'Criado':`n$($r.Saida)"
  Esperar (@($r.Chamadas | Where-Object { $_ -match '^tunnel create macuxi-demo' }).Count -eq 1) 'tunnel create não foi chamado uma vez'
}

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Base
Remove-Item Env:\MACUXI_SIMULADO_DIR -ErrorAction SilentlyContinue
Write-Host ''
if ($script:falhas -gt 0) { Write-Host "$($script:falhas) de $($script:casos) casos falharam." -ForegroundColor Red; exit 1 }
Write-Host "$($script:casos) casos ok." -ForegroundColor Green
exit 0
