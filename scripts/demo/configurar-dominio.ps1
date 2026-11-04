<#
.SYNOPSIS
  APOSENTADO EM 04/11/2026 (T-0074, ADR 0020). NÃO RODE: a demo agora fica na VM da Magalu Cloud, pelo túnel
  macuxi-demo-nuvem. Este script reapontaria o DNS de api-demo e bko-demo para o PC e tiraria a VM do ar. Ele recusa
  com saída 3, a menos que receba -EuSeiQueTiraAVmDoAr (só os testes simulados usam). Plano B local: subir-demo.ps1,
  só com túnel rápido (scripts/demo/LEIA-ME.md).

  Configura UMA vez o domínio fixo da demonstração (T-0038): túnel nomeado macuxi-demo, DNS de api-demo e bko-demo e o
  config.yml do cloudflared. Pode rodar de novo: o que já existe é reaproveitado, e nada é duplicado.

.DESCRIPTION
  Antes, uma vez: `cloudflared tunnel login` (abre o navegador; escolha macuxifdv.com.br). A autorização fica em
  %USERPROFILE%\.cloudflared, que este script NUNCA lê, copia nem move (doc 07, "Credenciais da Cloudflare"): ele só
  chama o cloudflared.
  1. acha (ou instala) o cloudflared;
  2. confere o login (cloudflared tunnel list);
  3. cria o túnel nomeado macuxi-demo, se ainda não existir;
  4. roteia api-demo.macuxifdv.com.br e bko-demo.macuxifdv.com.br para o túnel (cloudflared tunnel route dns; quando o
     nome já aponta para este túnel, nada muda);
  5. grava .dados\demo\cloudflared\config.yml (ingress: api-demo -> API, bko-demo -> BKO, resto -> 404) e o marcador
     tunel.json, que o subir-demo.ps1 usa para escolher o domínio fixo.
  Depois: só _instalar\subir-demo.cmd (ou scripts\demo\subir-demo.ps1).

.EXAMPLE
  cloudflared tunnel login
  powershell -ExecutionPolicy Bypass -File scripts\demo\configurar-dominio.ps1
#>
[CmdletBinding()]
param(
  [int]$PortaApi = 8100,
  [int]$PortaBko = 3100,
  # Se api-demo ou bko-demo já tiverem um registro DNS apontando para OUTRO lugar, troca pelo túnel (sem isso, para e avisa).
  [switch]$SobrescreverDns,
  # Sem winget/administrador: usa (ou baixa) o cloudflared portátil em .dados\demo\bin.
  [switch]$Portatil,
  # Pasta do config.yml e do marcador (padrão .dados\demo\cloudflared; os testes usam outra).
  [string]$PastaConfig,
  # Aposentado (T-0074): sem esta chave o script recusa. Só os testes simulados (teste/tunel.test.ps1) passam.
  [switch]$EuSeiQueTiraAVmDoAr
)

if (-not $EuSeiQueTiraAVmDoAr) {
  Write-Host "configurar-dominio.ps1 está APOSENTADO (T-0074, ADR 0020): api-demo e bko-demo apontam para a VM da Magalu Cloud" -ForegroundColor Red
  Write-Host "(túnel macuxi-demo-nuvem). Rodar este script reapontaria o DNS para o PC e tiraria a demo do ar. Nada foi feito." -ForegroundColor Red
  Write-Host "Plano B local: scripts\demo\subir-demo.ps1 (só túnel rápido). Veja scripts\demo\LEIA-ME.md." -ForegroundColor Yellow
  exit 3
}

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

. (Join-Path $PSScriptRoot 'tunel.ps1')

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $PastaConfig) { $PastaConfig = Join-Path $Raiz '.dados\demo\cloudflared' }
$ArquivoConfig = Join-Path $PastaConfig 'config.yml'

function Passo([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "    $texto" -ForegroundColor Green }
function Falha([string]$texto) { Write-Host ''; Write-Host "ERRO: $texto" -ForegroundColor Red; exit 1 }

# ---------- 1. cloudflared ----------
Passo '1/5 Conferindo o cloudflared'
try { $exe = Garantir-Cloudflared (Join-Path $Raiz '.dados\demo\bin\cloudflared.exe') -SoPortatil:$Portatil }
catch { Falha $_.Exception.Message }
Ok "cloudflared: $exe"

# ---------- 2. login ----------
Passo '2/5 Conferindo o login na Cloudflare'
try { $tuneis = @(Listar-Tuneis $exe $DemoTunelNome) }
catch {
  Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkGray
  Falha ('Não consegui listar os túneis da conta (detalhe acima). Se ainda não fez, rode uma vez: cloudflared tunnel login ' +
    '(abre o navegador; escolha o domínio macuxifdv.com.br) e depois este script de novo.')
}
Ok 'Login feito.'

# ---------- 3. túnel nomeado ----------
Passo "3/5 Túnel nomeado $DemoTunelNome"
if ($tuneis.Count -gt 0) {
  Ok "Já existe (id $($tuneis[0].id)): reaproveitado."
} else {
  $r = Rodar-Cloudflared $exe @('tunnel', 'create', $DemoTunelNome)
  $texto = ($r.Saida + "`n" + $r.Erro).Trim()
  $jaExiste = ($r.Codigo -ne 0) -and ($texto -match 'already exists')
  if ($r.Codigo -ne 0 -and -not $jaExiste) { Falha "cloudflared tunnel create falhou (código $($r.Codigo)): $texto" }
  # a lista pode demorar uns segundos para mostrar o túnel recém-criado: 3 tentativas
  for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
    try { $tuneis = @(Listar-Tuneis $exe $DemoTunelNome) } catch { Falha $_.Exception.Message }
    if ($tuneis.Count -gt 0 -or $jaExiste) { break }
    if ($tentativa -lt 3) { Start-Sleep -Seconds 3 }
  }
  if ($tuneis.Count -eq 0 -and $jaExiste) {
    Falha ("A Cloudflare respondeu que o túnel $DemoTunelNome JÁ EXISTE (cloudflared tunnel create: 'already exists'), mas " +
      "cloudflared tunnel list --name $DemoTunelNome não o mostra como ativo. Esperar não resolve. Confira com " +
      "'cloudflared tunnel list' e 'cloudflared tunnel info $DemoTunelNome' (login em outra conta? túnel apagado agora " +
      'e com o nome ainda reservado?) e mande a saída para o engenheiro-software.')
  }
  if ($tuneis.Count -eq 0) {
    Falha ("O túnel $DemoTunelNome foi criado, mas não aparece em cloudflared tunnel list --name $DemoTunelNome. " +
      'Rode este script de novo: ele reaproveita o túnel pelo nome, sem criar outro.')
  }
  if ($jaExiste) { Ok "Já existia (id $($tuneis[0].id)): reaproveitado." } else { Ok "Criado (id $($tuneis[0].id))." }
}
$idTunel = [string]$tuneis[0].id

# ---------- 4. DNS ----------
Passo '4/5 Apontando os nomes para o túnel (DNS na Cloudflare)'
foreach ($hostDemo in @($DemoHostApi, $DemoHostBko)) {
  $argumentos = @('tunnel', 'route', 'dns')
  if ($SobrescreverDns) { $argumentos += '--overwrite-dns' }
  $argumentos += @($idTunel, $hostDemo)
  $r = Rodar-Cloudflared $exe $argumentos
  $texto = ($r.Saida + "`n" + $r.Erro).Trim()
  if ($r.Codigo -ne 0) {
    if ($texto -match 'already exists') {
      Falha ("Já existe um registro DNS para $hostDemo que aponta para outro lugar. Confira no painel da Cloudflare " +
        '(DNS de macuxifdv.com.br) e, se puder trocar, rode de novo com -SobrescreverDns.')
    }
    Falha "cloudflared tunnel route dns $hostDemo falhou (código $($r.Codigo)): $texto"
  }
  if ($texto -match 'already configured') { Ok "$hostDemo já apontava para o túnel." } else { Ok "$hostDemo -> túnel $DemoTunelNome." }
}

# ---------- 5. config.yml ----------
Passo '5/5 Gravando o config.yml do túnel'
if (Gravar-ConfigTunel $ArquivoConfig $idTunel $PortaApi $PortaBko) { Ok "Gravado: $ArquivoConfig" } else { Ok "Sem mudança: $ArquivoConfig" }
$r = Rodar-Cloudflared $exe @('tunnel', '--config', $ArquivoConfig, 'ingress', 'validate')
if ($r.Codigo -ne 0) { Falha "O cloudflared recusou o config.yml (código $($r.Codigo)): $(($r.Saida + $r.Erro).Trim())" }
Gravar-MarcadorTunel $PastaConfig $idTunel $DemoTunelNome
Ok "Ingress: $DemoHostApi -> 127.0.0.1:$PortaApi · $DemoHostBko -> 127.0.0.1:$PortaBko · resto -> 404"

Write-Host ''
Write-Host 'Domínio da demonstração configurado.' -ForegroundColor Green
Write-Host '  Agora é só subir a demo: _instalar\subir-demo.cmd (ou scripts\demo\subir-demo.ps1).' -ForegroundColor White
Write-Host "  App: https://$DemoHostApi/v1   BKO: https://$DemoHostBko" -ForegroundColor White
Write-Host '  O DNS novo pode levar alguns minutos na primeira vez.' -ForegroundColor DarkGray
