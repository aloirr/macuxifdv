<#
.SYNOPSIS
  Funções do cloudflared compartilhadas pelos scripts da demo (T-0038). Uso: . (Join-Path $PSScriptRoot 'tunel.ps1')

.DESCRIPTION
  Túnel nomeado (domínio fixo, configurado uma vez pelo configurar-dominio.ps1) e túnel rápido (trycloudflare, reserva).
  REGRA (doc 07, "Credenciais da Cloudflare"): nada aqui lê, copia, move ou lista %USERPROFILE%\.cloudflared (cert.pem e o
  JSON do túnel). Os scripts só chamam o cloudflared, que acha a autorização e a credencial sozinho. O config.yml e o
  marcador ficam em .dados\demo\cloudflared (fora do git) e não têm segredo: o id do túnel é público (CNAME
  <id>.cfargotunnel.com).
  MACUXI_CLOUDFLARED (caminho de um executável) troca o cloudflared, por exemplo por um simulado nos testes.
#>

$DemoTunelNome = 'macuxi-demo'
$DemoHostApi = 'api-demo.macuxifdv.com.br'
$DemoHostBko = 'bko-demo.macuxifdv.com.br'

# cloudflared: MACUXI_CLOUDFLARED, PATH, lugares do instalador/winget ou o portátil baixado antes. $null se não houver.
function Achar-Cloudflared([string]$Portatil) {
  if ($env:MACUXI_CLOUDFLARED) {
    if (Test-Path $env:MACUXI_CLOUDFLARED) { return (Resolve-Path $env:MACUXI_CLOUDFLARED).Path }
    throw "MACUXI_CLOUDFLARED aponta para um arquivo que não existe: $($env:MACUXI_CLOUDFLARED)"
  }
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $candidatos = @(
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'),
    $Portatil
  )
  foreach ($x in $candidatos) { if ($x -and (Test-Path $x)) { return $x } }
  return $null
}

# Acha ou instala o cloudflared: winget (Cloudflare.cloudflared) e, sem winget ou sem administrador, o executável portátil
# oficial em $Portatil, só se a assinatura digital da Cloudflare for válida. Devolve o caminho; lança erro se não der.
function Garantir-Cloudflared([string]$Portatil, [switch]$SoPortatil) {
  $exe = Achar-Cloudflared $Portatil
  if ($exe) { return $exe }
  if (-not $SoPortatil -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host '    cloudflared não encontrado: instalando com winget (Cloudflare.cloudflared; o Windows pede para autorizar)...' -ForegroundColor Yellow
    $antes = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --disable-interactivity }
    finally { $ErrorActionPreference = $antes }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $exe = Achar-Cloudflared $Portatil
    if ($exe) { return $exe }
  }
  Write-Host '    Instalação pelo winget não concluída: baixando o cloudflared portátil (release oficial no GitHub)...' -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path (Split-Path $Portatil) | Out-Null
  $temp = Join-Path (Split-Path $Portatil) 'cloudflared-baixando.exe'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $temp
  } catch { throw "Não consegui baixar o cloudflared ($($_.Exception.Message)). Instale manualmente: winget install Cloudflare.cloudflared" }
  $assinatura = Get-AuthenticodeSignature -FilePath $temp
  if ($assinatura.Status -ne 'Valid' -or $assinatura.SignerCertificate.Subject -notmatch 'Cloudflare') {
    Remove-Item -Force $temp
    throw "O cloudflared baixado não tem assinatura válida da Cloudflare ($($assinatura.Status)). Instale manualmente: winget install Cloudflare.cloudflared"
  }
  Move-Item -Force $temp $Portatil
  return $Portatil
}

function Citar-Argumento([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Roda o cloudflared e espera (comandos curtos: list, create, route dns, ingress validate). Saída e erro separados
# (a lista em JSON sai no stdout e o log no stderr). Devolve { Codigo; Saida; Erro }.
function Rodar-Cloudflared([string]$exe, [string[]]$argumentos, [int]$Segundos = 120) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = (@($argumentos | ForEach-Object { Citar-Argumento $_ })) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [Diagnostics.Process]::Start($psi)
  $saida = $p.StandardOutput.ReadToEndAsync()
  $erro = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($Segundos * 1000)) {
    try { $p.Kill() } catch { }
    return [pscustomobject]@{ Codigo = -1; Saida = ''; Erro = "cloudflared $($argumentos -join ' ') não terminou em $Segundos s" }
  }
  $p.WaitForExit()
  return [pscustomobject]@{ Codigo = $p.ExitCode; Saida = $saida.Result; Erro = $erro.Result }
}

# Túnel apagado? O `cloudflared tunnel list --output json` devolve "deleted_at": "0001-01-01T00:00:00Z" (tempo zero do Go)
# para túnel ATIVO; no PowerShell 7 o ConvertFrom-Json transforma isso num DateTime do ano 1. Apagado só quando o campo
# existe, não é vazio e não é o tempo zero.
function Tunel-Apagado($Tunel) {
  if ($null -eq $Tunel -or -not ($Tunel.PSObject.Properties.Name -contains 'deleted_at')) { return $false }
  $d = $Tunel.deleted_at
  if ($null -eq $d) { return $false }
  if ($d -is [datetime] -or $d -is [datetimeoffset]) { return ($d.Year -gt 1) }
  $s = ([string]$d).Trim()
  if (-not $s -or $s.StartsWith('0001-01-01')) { return $false }
  return $true
}

# Túneis nomeados da conta (exige o `cloudflared tunnel login` feito). Devolve a lista ou lança erro com a saída do cloudflared.
function Listar-Tuneis([string]$exe, [string]$Nome) {
  $r = Rodar-Cloudflared $exe @('tunnel', 'list', '--output', 'json', '--name', $Nome)
  if ($r.Codigo -ne 0) { throw "cloudflared tunnel list falhou (código $($r.Codigo)): $($r.Erro.Trim())" }
  $texto = $r.Saida.Trim()
  if (-not $texto -or $texto -eq 'null') { return @() }
  # no PowerShell 5.1 o ConvertFrom-Json devolve o array inteiro como UM objeto no pipeline: enumerar com foreach
  $dados = ConvertFrom-Json $texto
  $achados = @()
  foreach ($t in @($dados)) {
    if ($null -eq $t) { continue }
    $nomes = $t.PSObject.Properties.Name
    if (($nomes -contains 'name') -and $t.name -eq $Nome -and -not (Tunel-Apagado $t)) { $achados += $t }
  }
  return $achados
}

# Texto do config.yml do túnel nomeado. Sem credentials-file: o cloudflared acha <id>.json sozinho na pasta dele.
function Texto-ConfigTunel([string]$Id, [int]$PortaApi, [int]$PortaBko) {
  return @(
    '# Gerado por scripts/demo (T-0038): túnel nomeado da demonstração. Pode apagar: o subir-demo.ps1 grava de novo.',
    '# Sem segredo: a credencial do túnel (<id>.json) fica com o cloudflared, em %USERPROFILE%\.cloudflared.',
    "tunnel: $Id",
    'ingress:',
    "  - hostname: $DemoHostApi",
    "    service: http://127.0.0.1:$PortaApi",
    "  - hostname: $DemoHostBko",
    "    service: http://127.0.0.1:$PortaBko",
    '  - service: http_status:404',
    ''
  ) -join "`n"
}

# Grava o config.yml (UTF-8 sem BOM) só se o conteúdo mudou. Devolve $true se gravou.
function Gravar-ConfigTunel([string]$Caminho, [string]$Id, [int]$PortaApi, [int]$PortaBko) {
  $texto = Texto-ConfigTunel $Id $PortaApi $PortaBko
  if ((Test-Path $Caminho) -and ([IO.File]::ReadAllText($Caminho) -eq $texto)) { return $false }
  New-Item -ItemType Directory -Force -Path (Split-Path $Caminho) | Out-Null
  [IO.File]::WriteAllText($Caminho, $texto, (New-Object Text.UTF8Encoding($false)))
  return $true
}

# Marcador do túnel nomeado (.dados\demo\cloudflared\tunel.json): o subir-demo.ps1 usa o domínio fixo se ele existir.
function Ler-MarcadorTunel([string]$Pasta) {
  $arq = Join-Path $Pasta 'tunel.json'
  if (-not (Test-Path $arq)) { return $null }
  try { $m = Get-Content -Raw -Path $arq | ConvertFrom-Json } catch { return $null }
  if (-not ($m.PSObject.Properties.Name -contains 'id') -or $m.id -notmatch '^[0-9a-fA-F-]{36}$') { return $null }
  return $m
}

function Gravar-MarcadorTunel([string]$Pasta, [string]$Id, [string]$Nome) {
  New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
  $m = [ordered]@{ nome = $Nome; id = $Id; hosts = @($DemoHostApi, $DemoHostBko); configurado_em = (Get-Date).ToUniversalTime().ToString('o') }
  [IO.File]::WriteAllText((Join-Path $Pasta 'tunel.json'), ($m | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

# Sobe um processo em segundo plano (janela oculta) com saída em <pasta>\<nome>.log e <nome>.erro.log; devolve o PID.
function Iniciar-Processo([string]$Pasta, [string]$Nome, [string]$exe, [string[]]$argumentos, [string]$Diretorio) {
  $log = Join-Path $Pasta "$Nome.log"
  $logErro = Join-Path $Pasta "$Nome.erro.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $log, $logErro
  $p = Start-Process -FilePath $exe -ArgumentList (@($argumentos | ForEach-Object { Citar-Argumento $_ })) -WorkingDirectory $Diretorio `
    -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $logErro -PassThru
  return $p.Id
}

function Encerrar-Arvore($id) {
  if (-not $id -or -not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return }
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & taskkill.exe /PID $id /T /F *> $null } finally { $ErrorActionPreference = $antes }
}

# Espera um padrão no log de erro do cloudflared (é lá que ele escreve). Devolve o 1º trecho casado, ou $null se o
# processo morreu ou o tempo acabou.
function Esperar-NoLog([string]$Log, [string]$Padrao, $ProcessoId, [int]$Segundos) {
  $limite = (Get-Date).AddSeconds($Segundos)
  while ((Get-Date) -lt $limite) {
    if (Test-Path $Log) {
      $m = Select-String -Path $Log -Pattern $Padrao -AllMatches | Select-Object -First 1
      if ($m) { return $m.Matches[0].Value }
    }
    if (-not (Get-Process -Id $ProcessoId -ErrorAction SilentlyContinue)) { return $null }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

# Túnel nomeado: `cloudflared tunnel run` com o config.yml (ingress api-demo e bko-demo). Espera a 1ª conexão registrada
# com a Cloudflare. Devolve { Pid; Api; Bko } ou $null (morreu ou não conectou; o processo é encerrado e o log fica).
function Abrir-TunelNomeado([string]$exe, [string]$PastaLogs, [string]$Config, [string]$Id, [string]$Diretorio, [int]$Segundos = 120) {
  $processo = Iniciar-Processo $PastaLogs 'tunel' $exe @('tunnel', '--no-autoupdate', '--config', $Config, 'run', $Id) $Diretorio
  $ok = Esperar-NoLog (Join-Path $PastaLogs 'tunel.erro.log') 'Registered tunnel connection' $processo $Segundos
  if (-not $ok) { Encerrar-Arvore $processo; return $null }
  return [pscustomobject]@{ Pid = $processo; Api = "https://$DemoHostApi"; Bko = "https://$DemoHostBko" }
}

# Escolha do túnel da demo (passo 6 do subir-demo.ps1): o nomeado se o configurar-dominio.ps1 já rodou neste PC (marcador
# em $PastaCf) e ele conectar; senão, ou com -Rapido, o túnel rápido da API, com aviso. O config.yml é regravado com as
# portas desta subida. Devolve { Modo = 'nomeado'|'rapido'; Pid; Api; Bko } (Bko nulo no rápido) ou $null se nenhum abriu.
function Abrir-TunelDemo([string]$exe, [string]$PastaLogs, [string]$PastaCf, [int]$PortaApi, [int]$PortaBko, [string]$Diretorio,
  [switch]$Rapido, [int]$SegundosNomeado = 120, [int]$SegundosRapido = 180) {
  $marcador = Ler-MarcadorTunel $PastaCf
  if ($marcador -and -not $Rapido) {
    $config = Join-Path $PastaCf 'config.yml'
    [void](Gravar-ConfigTunel $config $marcador.id $PortaApi $PortaBko)
    Write-Host "    Túnel nomeado $DemoTunelNome (domínio fixo): conectando..." -ForegroundColor Green
    $t = Abrir-TunelNomeado $exe $PastaLogs $config $marcador.id $Diretorio $SegundosNomeado
    if ($t) { return [pscustomobject]@{ Modo = 'nomeado'; Pid = $t.Pid; Api = $t.Api; Bko = $t.Bko } }
    Write-Host "    O túnel nomeado não conectou (veja $PastaLogs\tunel.erro.log): usando o túnel rápido." -ForegroundColor Yellow
    Write-Host '    Causas comuns: sem internet, ou este PC não tem a credencial do túnel (rode configurar-dominio.ps1 aqui).' -ForegroundColor Yellow
  } elseif (-not $Rapido) {
    Write-Host '    Domínio fixo não configurado neste PC (falta rodar scripts\demo\configurar-dominio.ps1 uma vez): usando o túnel rápido.' -ForegroundColor Yellow
  }
  $t = Abrir-TunelRapido $exe $PastaLogs 'tunel-rapido' $PortaApi $Diretorio $SegundosRapido
  if (-not $t) { return $null }
  return [pscustomobject]@{ Modo = 'rapido'; Pid = $t.Pid; Api = $t.Url; Bko = $null }
}

# Túnel rápido (trycloudflare, sem conta): um endereço aleatório por processo. Devolve { Pid; Url } ou $null.
# A 1ª execução pode levar mais de 1 min para escrever o endereço (antivírus examinando o exe novo).
function Abrir-TunelRapido([string]$exe, [string]$PastaLogs, [string]$Nome, [int]$Porta, [string]$Diretorio, [int]$Segundos = 180) {
  $processo = Iniciar-Processo $PastaLogs $Nome $exe @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Porta") $Diretorio
  $url = Esperar-NoLog (Join-Path $PastaLogs "$Nome.erro.log") 'https://[a-z0-9-]+\.trycloudflare\.com' $processo $Segundos
  if (-not $url) { Encerrar-Arvore $processo; return $null }
  return [pscustomobject]@{ Pid = $processo; Url = $url }
}
