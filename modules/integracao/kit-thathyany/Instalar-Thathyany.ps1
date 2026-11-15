<#
.SYNOPSIS
  Kit da thathyany (T-0174): prepara o ERP local (SQL Server Express, banco ERP_THATHYANY) neste notebook e liga a empresa
  thathyany ao Macuxi em uma das duas fases do teste (RN-INT-13: uma forma de integracao ativa por vez).

.DESCRIPTION
  Rode como administrador, no Windows PowerShell 5.1 (o azul). Pode rodar quantas vezes quiser: o que ja esta pronto e pulado.
  Senhas e chaves: area de transferencia (limpa logo depois), Read-Host mascarado e Gerenciador de Credenciais do Windows; nada vai para arquivo ou log.

.PARAMETER Fase
  Conector (fase 1): instala o Conector 1.4.0 baixado do portal como servico e desliga o "ERP via API".
  API (fase 2): para e desativa o servico do Conector, desabilita o login dele e liga o "ERP via API" com outra credencial.

.PARAMETER ConectorZip
  Pacote baixado em "Baixar o Conector" do portal (conector-1.4.0.zip). Padrao: o conector-*.zip mais novo ao lado deste
  script ou na pasta Downloads.

.PARAMETER Instancia
  Nome da instancia do SQL Server (ex.: SQLEXPRESS; MSSQLSERVER para a padrao). Vazio = detectar. So e preciso informar se houver mais de uma.

.PARAMETER TrocarChave
  Pede de novo a chave da fase, mesmo que ja exista.
#>
#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Conector', 'API')][string]$Fase,
    [string]$ConectorZip,
    [switch]$TrocarChave,
    [string]$Instancia = '',
    [string]$Pasta = 'C:\MacuxiThathyany'
)

$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
Get-ChildItem -LiteralPath $kit -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
$BANCO = 'ERP_THATHYANY'
$SERVIDOR_SQL = ''
$SERVICO_SQL = ''
$ID_REGISTRO_SQL = ''
$PASTA_CSV = Join-Path $Pasta 'csv'
$PASTA_API = Join-Path $Pasta 'erp-via-api'
$PASTA_CONECTOR = 'C:\ProgramData\Macuxi\Conector'
$SERVICO_CONECTOR = 'MacuxiConector'
$TAREFA_API = 'Macuxi ERP via API'
$CREDENCIAL_CHAVE_API = 'Macuxi.Thathyany/hub_chave_api'
$CREDENCIAL_SENHA_API = 'Macuxi.Thathyany/erp_senha_api'
$REGEX_CHAVE = '^mxc_[A-Za-z0-9_-]{43}$'

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "   [atencao] $t" -ForegroundColor Yellow }
function Falha($t) { throw $t }

if ($PSVersionTable.PSEdition -ne 'Desktop') { Falha 'Abra o "Windows PowerShell" (o azul, versao 5.1) como administrador. O PowerShell 7 nao serve para este kit.' }

# ---------------------------------------------------------------------------------------------------------------------
# Utilitarios
# ---------------------------------------------------------------------------------------------------------------------
function SenhaAleatoria {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    'Mx' + [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', '') + '9z'
}

# Limpa a area de transferencia depois de ler a chave (a chave nao fica copiada no Windows).
function Limpar-AreaTransferencia {
    try { Set-Clipboard -Value $null } catch {
        try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear() } catch { Aviso 'Nao consegui limpar a area de transferencia. Copie qualquer outro texto.' }
    }
}

# No console do Windows PowerShell 5.1, colar no Read-Host -AsSecureString entra um caractere so: a chave vem da area de
# transferencia (copiada no portal antes de rodar); digitar fica de reserva. Nada disso vai para a tela nem para log.
function PedirChave($identificador) {
    $copiada = $null
    try { $copiada = Get-Clipboard -Raw -ErrorAction Stop } catch { $copiada = $null }
    if ($copiada) { $copiada = $copiada.Trim() }
    if ($copiada -and $copiada -match $REGEX_CHAVE) {
        Limpar-AreaTransferencia
        Ok "chave do Conector '$identificador' lida da area de transferencia"
        return $copiada
    }
    $copiada = $null
    for ($i = 0; $i -lt 3; $i++) {
        $seguro = Read-Host -AsSecureString "Digite a chave gerada no portal para o Conector '$identificador' (comeca com mxc_; o texto fica oculto)"
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
        try { $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if ($chave -match $REGEX_CHAVE) { return $chave }
        Aviso 'Essa chave nao tem o formato certo (mxc_ e mais 43 caracteres). Copie a chave no portal e rode o instalador de novo.'
    }
    Falha 'Chave invalida tres vezes. Copie a chave no portal (ou gere uma nova) e rode o instalador de novo.'
}

function Abrir-Sql([string]$banco = 'master') {
    $c = New-Object System.Data.SqlClient.SqlConnection("Server=$SERVIDOR_SQL;Database=$banco;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=15")
    $c.Open()
    $c
}

function Executar-Sql($conn, [string]$texto) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $texto
    $cmd.CommandTimeout = 120
    [void]$cmd.ExecuteNonQuery()
}

# Roda um arquivo .sql com lotes separados por GO. $troca: variaveis $(NOME) trocadas so na memoria.
function Executar-Arquivo-Sql($conn, [string]$arquivo, [hashtable]$troca = @{}) {
    $texto = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8
    foreach ($k in $troca.Keys) { $texto = $texto.Replace('$(' + $k + ')', [string]$troca[$k]) }
    foreach ($lote in [regex]::Split($texto, '(?im)^\s*GO\s*$')) {
        if ($lote.Trim().Length -gt 0) { Executar-Sql $conn $lote }
    }
}

function Winget-Instalar([string[]]$ids, [string]$nome) {
    foreach ($id in $ids) {
        & winget list --id $id --exact --accept-source-agreements *> $null
        if ($LASTEXITCODE -eq 0) { Ok "$nome ja instalado ($id)"; return }
    }
    foreach ($id in $ids) {
        & winget show --id $id --exact --accept-source-agreements *> $null
        if ($LASTEXITCODE -ne 0) { continue }
        Write-Host "   instalando $nome ($id)... pode demorar alguns minutos" -ForegroundColor Gray
        & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189) { Ok "$nome instalado"; return }
        Falha "O winget nao conseguiu instalar $nome ($id), codigo $LASTEXITCODE. Rode de novo; se repetir, instale $nome a mao."
    }
    Falha "O winget nao achou $nome. Atualize o 'Instalador de Aplicativo' na Microsoft Store e rode de novo."
}

function Atualizar-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------------------------------------------------------------------------------------------------------------------
# 0. Instancia do SQL Server ja instalada (o instalador nao instala SQL Server)
# ---------------------------------------------------------------------------------------------------------------------
function Detectar-Instancia {
    Titulo '0. Instancia do SQL Server'
    $achadas = @{}
    $chaveNomes = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
    if (Test-Path $chaveNomes) {
        $mapa = Get-ItemProperty $chaveNomes
        foreach ($prop in $mapa.PSObject.Properties) {
            if ($prop.Name -notlike 'PS*') { $achadas[$prop.Name.ToUpper()] = [string]$prop.Value }
        }
    }
    foreach ($svc in @(Get-Service -Name 'MSSQL$*' -ErrorAction SilentlyContinue)) {
        $n = $svc.Name.Substring(6).ToUpper()
        if (-not $achadas.ContainsKey($n)) { $achadas[$n] = '' }
    }
    if (Get-Service -Name 'MSSQLSERVER' -ErrorAction SilentlyContinue) {
        if (-not $achadas.ContainsKey('MSSQLSERVER')) { $achadas['MSSQLSERVER'] = '' }
    }
    $nomes = @($achadas.Keys | Sort-Object)
    if ($nomes.Count -eq 0) {
        Falha ("Nao encontrei o SQL Server neste notebook. Instale a mao o SQL Server 2022 Express (instalacao Basica) no idioma do Windows, pelo link oficial https://www.microsoft.com/pt-br/sql-server/sql-server-downloads (Express), e rode este instalador de novo. Idioma deste Windows: $((Get-Culture).Name) / $((Get-UICulture).Name).")
    }
    $escolhida = $null
    if ($Instancia.Trim() -ne '') {
        $pedida = $Instancia.Trim().ToUpper()
        if ($pedida -like '.\*') { $pedida = $pedida.Substring(2) }
        if (-not $achadas.ContainsKey($pedida)) { Falha "A instancia '$Instancia' nao existe neste notebook. Instancias encontradas: $($nomes -join ', '). Rode de novo com -Instancia <nome>." }
        $escolhida = $pedida
    }
    elseif ($nomes.Count -gt 1) {
        Falha "Ha mais de uma instancia do SQL Server neste notebook: $($nomes -join ', '). Rode de novo com -Instancia <nome>."
    }
    else { $escolhida = $nomes[0] }
    $script:ID_REGISTRO_SQL = $achadas[$escolhida]
    if ($escolhida -eq 'MSSQLSERVER') {
        $script:SERVIDOR_SQL = '.'
        $script:SERVICO_SQL = 'MSSQLSERVER'
    }
    else {
        $script:SERVIDOR_SQL = ".\$escolhida"
        $script:SERVICO_SQL = 'MSSQL$' + $escolhida
    }
    if (-not $script:ID_REGISTRO_SQL) { Falha "Nao achei o registro da instancia $escolhida. Confira a instalacao do SQL Server e rode de novo." }
    Ok "usando a instancia $escolhida (servidor $SERVIDOR_SQL)"
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Programas
# ---------------------------------------------------------------------------------------------------------------------
# Cada Achar-* devolve onde o programa esta (texto) ou $null. Achado no computador vence o winget: instalacao manual nao aparece no "winget list".
function Achar-Ssms {
    $exe = Get-ChildItem -Path "$env:SystemDrive\Program Files*\Microsoft SQL Server Management Studio*" -Filter 'Ssms.exe' -Recurse -Depth 6 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) { return $exe.FullName }
    $cmd = Get-Command ssms.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $null
}
function Achar-Odbc {
    $nome = 'ODBC Driver 18 for SQL Server'
    $driver = Get-OdbcDriver -Name $nome -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($driver) { return "$nome ($($driver.Platform))" }
    if (Test-Path "HKLM:\SOFTWARE\ODBC\ODBCINST.INI\$nome") { return $nome }
    $null
}
function Achar-Node {
    $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (Test-Path $npm) { return $npm }
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $null
}

# Python 3.10 ou mais novo: o py.exe (launcher) ou o python.exe do PATH. Devolve @(comando, argumentos) ou $null.
function Achar-Python {
    foreach ($tentativa in @(@('py.exe', @('-3')), @('python.exe', @()))) {
        $cmd = Get-Command $tentativa[0] -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        $args0 = $tentativa[1]
        $versao = & $cmd.Source @args0 -c 'import sys; print(sys.version_info >= (3, 10))' 2>$null
        if ($LASTEXITCODE -eq 0 -and "$versao".Trim() -eq 'True') { return , @($cmd.Source, $args0) }
    }
    $null
}

function Garantir-Programa([string]$nome, [scriptblock]$achar, [string[]]$ids) {
    $onde = & $achar
    if ($onde) { Ok "$nome ja instalado: $onde"; return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Falha "Falta $nome e o winget nao esta instalado. Instale $nome a mao (ou atualize o 'Instalador de Aplicativo' na Microsoft Store) e rode de novo." }
    Winget-Instalar $ids $nome
    Atualizar-Path
}

function Passo-Programas {
    Titulo '1. Programas'
    Garantir-Programa 'SQL Server Management Studio (SSMS)' { Achar-Ssms } @('Microsoft.SQLServerManagementStudio.22', 'Microsoft.SQLServerManagementStudio.21', 'Microsoft.SQLServerManagementStudio')
    Garantir-Programa 'ODBC Driver 18 for SQL Server' { Achar-Odbc } @('Microsoft.msodbcsql.18')
    Garantir-Programa 'Python 3' { $p = Achar-Python; if ($p) { $p[0] } } @('Python.Python.3.12', 'Python.Python.3.13')
    if ($Fase -eq 'API') { Garantir-Programa 'Node.js LTS' { Achar-Node } @('OpenJS.NodeJS.LTS') }
    $py = Achar-Python
    if (-not $py) { Falha 'Nao achei o Python 3.10 ou mais novo (py.exe ou python.exe). Feche e abra o PowerShell como administrador e rode de novo.' }
    $pyArgs = $py[1]
    & $py[0] @pyArgs -m pip install --quiet --disable-pip-version-check pyodbc
    if ($LASTEXITCODE -ne 0) { Falha 'O pip nao conseguiu instalar o pyodbc. Confira a internet e rode de novo.' }
    Ok 'pyodbc pronto para o carga_csv.py'
}

# ---------------------------------------------------------------------------------------------------------------------
# 2. SQL Server: TCP 1433 so nesta maquina e autenticacao mista (o Conector e o ERP via API entram com login SQL)
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Sql {
    Titulo '2. SQL Server: TCP 1433 e autenticacao mista'
    $raiz = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$ID_REGISTRO_SQL\MSSQLServer"
    $tcp = "$raiz\SuperSocketNetLib\Tcp"
    $mudou = $false
    if ((Get-ItemProperty $raiz).LoginMode -ne 2) { Set-ItemProperty $raiz -Name LoginMode -Value 2; $mudou = $true }
    if ((Get-ItemProperty $tcp).Enabled -ne 1) { Set-ItemProperty $tcp -Name Enabled -Value 1; $mudou = $true }
    $p = Get-ItemProperty "$tcp\IPAll"
    if ($p.TcpPort -ne '1433' -or $p.TcpDynamicPorts -ne '') { Set-ItemProperty "$tcp\IPAll" -Name TcpPort -Value '1433'; Set-ItemProperty "$tcp\IPAll" -Name TcpDynamicPorts -Value ''; $mudou = $true }
    if ($mudou) { Restart-Service -Name $SERVICO_SQL -Force; Ok 'TCP 1433 e autenticacao mista ligados (servico reiniciado)' }
    else { Ok 'TCP 1433 e autenticacao mista ja estavam ligados' }
    if ((Get-Service $SERVICO_SQL).StartType -ne 'Automatic') { Set-Service $SERVICO_SQL -StartupType Automatic }
    if ((Get-Service $SERVICO_SQL).Status -ne 'Running') { Start-Service $SERVICO_SQL }
    for ($i = 0; $i -lt 30; $i++) {
        try { $c = Abrir-Sql; $c.Close(); break } catch { Start-Sleep -Seconds 2; if ($i -eq 29) { Falha "Nao consegui conectar no SQL Server: $($_.Exception.Message)" } }
    }
    # Sem regra de firewall: o Conector e o ERP via API rodam neste notebook (127.0.0.1).
}

# ---------------------------------------------------------------------------------------------------------------------
# 3. Banco ERP_THATHYANY e pasta dos CSVs
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Banco {
    Titulo "3. Banco $BANCO"
    $conn = Abrir-Sql
    try { Executar-Arquivo-Sql $conn (Join-Path $kit 'sql\criar-banco.sql') } finally { $conn.Close() }
    Ok 'tabelas tha_*, views vw_macuxi_* e entrada de pedidos prontas'
    New-Item -ItemType Directory -Force -Path $PASTA_CSV | Out-Null
    foreach ($modelo in Get-ChildItem -LiteralPath (Join-Path $kit 'modelos') -Filter '*.csv') {
        $destino = Join-Path $PASTA_CSV $modelo.Name
        if (-not (Test-Path $destino)) { Copy-Item -LiteralPath $modelo.FullName -Destination $destino }
    }
    Copy-Item -LiteralPath (Join-Path $kit 'carga_csv.py'), (Join-Path $kit 'contrato.json') -Destination $Pasta -Force
    [IO.File]::WriteAllText((Join-Path $Pasta 'servidor.txt'), $SERVIDOR_SQL, (New-Object System.Text.UTF8Encoding($false)))
    Ok "servidor.txt grava o servidor $SERVIDOR_SQL para o carga_csv.py"
    Ok "CSVs em $PASTA_CSV (modelo novo so entra onde ainda nao havia arquivo; o seu nao e trocado)"
}

function Trocar-Senha-Login([string]$arquivoSql) {
    $senha = SenhaAleatoria
    $conn = Abrir-Sql
    try { Executar-Arquivo-Sql $conn (Join-Path $kit "sql\$arquivoSql") @{ SENHA = $senha } } finally { $conn.Close() }
    $senha
}

# ---------------------------------------------------------------------------------------------------------------------
# 4a. Fase 1 - Conector 1.4.0 (baixado do portal)
# ---------------------------------------------------------------------------------------------------------------------
function Conceder-Logon-Servico([string]$conta) {
    if (-not ('Macuxi.Lsa' -as [type])) {
        Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Security.Principal;
namespace Macuxi { public static class Lsa {
  [StructLayout(LayoutKind.Sequential)] struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public int Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public string Buffer; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr s, ref LSA_OBJECT_ATTRIBUTES a, int access, out IntPtr policy);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LSA_UNICODE_STRING[] rights, int count);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr policy);
  public static void Conceder(string conta) {
    NTAccount nt = new NTAccount(conta); SecurityIdentifier sid = (SecurityIdentifier)nt.Translate(typeof(SecurityIdentifier));
    byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
    LSA_OBJECT_ATTRIBUTES attr = new LSA_OBJECT_ATTRIBUTES(); IntPtr policy;
    if (LsaOpenPolicy(IntPtr.Zero, ref attr, 0x00000811, out policy) != 0) throw new Exception("LsaOpenPolicy falhou");
    try {
      string direito = "SeServiceLogonRight";
      LSA_UNICODE_STRING[] r = new LSA_UNICODE_STRING[1]; r[0].Buffer = direito; r[0].Length = (ushort)(direito.Length * 2); r[0].MaximumLength = (ushort)(direito.Length * 2 + 2);
      uint rc = LsaAddAccountRights(policy, bytes, r, 1); if (rc != 0) throw new Exception("LsaAddAccountRights falhou: " + rc);
    } finally { LsaClose(policy); }
  } } }
'@
    }
    [Macuxi.Lsa]::Conceder($conta)
}

function Achar-ConectorZip {
    if ($ConectorZip) {
        if (Test-Path -LiteralPath $ConectorZip) { return (Resolve-Path -LiteralPath $ConectorZip).Path }
        Falha "Nao achei o pacote $ConectorZip."
    }
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    $achado = Get-ChildItem -Path $kit, $downloads -Filter 'conector-*.zip' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $achado) { Falha 'Nao achei o conector-1.4.0.zip. Baixe pelo "Baixar o Conector" do portal (aba Integracao) e rode de novo.' }
    $achado.FullName
}

function Passo-Conector {
    Titulo '4. Fase 1: Conector 1.4.0'
    $zip = Achar-ConectorZip
    Ok "pacote: $(Split-Path $zip -Leaf)"
    if (Get-ScheduledTask -TaskName $TAREFA_API -ErrorAction SilentlyContinue) {
        Disable-ScheduledTask -TaskName $TAREFA_API | Out-Null
        Ok "tarefa ""$TAREFA_API"" desativada (uma forma de integracao por vez)"
    }
    $senha = Trocar-Senha-Login 'usuario-conector.sql'
    Ok 'login macuxi_conector pronto'

    $existe = Get-Service -Name $SERVICO_CONECTOR -ErrorAction SilentlyContinue
    if ($existe -and $existe.Status -eq 'Running') { Stop-Service $SERVICO_CONECTOR -Force }
    New-Item -ItemType Directory -Force -Path $PASTA_CONECTOR | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $PASTA_CONECTOR -Force
    Copy-Item -LiteralPath (Join-Path $kit 'conector\conector.json') -Destination (Join-Path $PASTA_CONECTOR 'conector.json') -Force
    $node = Join-Path $PASTA_CONECTOR 'node.exe'
    $conf = Join-Path $PASTA_CONECTOR 'conector.json'
    Push-Location $PASTA_CONECTOR
    try {
        $versao = (& $node 'conector.mjs' 'versao' | Select-Object -First 1)
        if ($versao -notmatch '^1\.(4|[5-9])\.') { Aviso "Conector ${versao}: este kit pede o 1.4.0 ou mais novo. Baixe de novo no portal." }
        $senha | & $node 'conector.mjs' 'segredo' 'definir' 'erp_senha' '--config' $conf | Out-Null
        if ($LASTEXITCODE -ne 0) { Falha 'O Conector nao guardou a senha do banco no Gerenciador de Credenciais.' }
        $senha = $null
        if ($TrocarChave -or -not $existe) {
            $chave = PedirChave 'thathyany-conector'
            $chave | & $node 'conector.mjs' 'segredo' 'definir' 'hub_chave' '--config' $conf | Out-Null
            if ($LASTEXITCODE -ne 0) { Falha 'O Conector nao guardou a chave.' }
            $chave = $null
            Ok 'chave guardada no Gerenciador de Credenciais'
        } else { Ok 'chave ja estava guardada (use -TrocarChave para trocar)' }
        & $node 'conector.mjs' 'validar-config' '--config' $conf
        if ($LASTEXITCODE -ne 0) { Falha 'O conector.json nao passou na validacao.' }
        & $node 'conector.mjs' 'testar-conexao' '--config' $conf
        if ($LASTEXITCODE -ne 0) { Aviso 'O teste de conexao falhou. Veja a mensagem acima e a secao "Se der errado" do ROTEIRO.md.' }
        if (-not $existe) {
            & $node 'conector.mjs' 'instalar-servico' '--winsw' (Join-Path $PASTA_CONECTOR 'WinSW-x64.exe') '--config' $conf
            if ($LASTEXITCODE -ne 0) { Falha 'Nao consegui instalar o servico do Conector.' }
            Ok 'servico "Macuxi Conector" instalado'
        }
    } finally { Pop-Location }

    # O Gerenciador de Credenciais e por usuario: o servico roda na conta que guardou os segredos.
    $conta = "$env:USERDOMAIN\$env:USERNAME"
    $cim = Get-CimInstance Win32_Service -Filter "Name='$SERVICO_CONECTOR'"
    if ($cim.StartName -ne $conta -and $cim.StartName -ne ".\$env:USERNAME") {
        $senhaWin = Read-Host -AsSecureString "Senha do Windows de $conta (o texto fica oculto)"
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaWin)
        try {
            Conceder-Logon-Servico $conta
            $rc = (Invoke-CimMethod -InputObject $cim -MethodName Change -Arguments @{ StartName = $conta; StartPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }).ReturnValue
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if ($rc -ne 0) { Aviso "O Windows recusou a conta do servico (codigo $rc). Abra services.msc, Macuxi Conector, aba Fazer logon, informe sua conta e inicie o servico." }
    }
    Set-Service -Name $SERVICO_CONECTOR -StartupType Automatic
    try { Start-Service -Name $SERVICO_CONECTOR; Ok 'servico do Conector iniciado' } catch { Aviso "Nao consegui iniciar o servico: $($_.Exception.Message.Split([char]10)[0])" }
}

# ---------------------------------------------------------------------------------------------------------------------
# 4b. Fase 2 - Conector desativado e "ERP via API" com outra credencial
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Api {
    Titulo '4. Fase 2: Conector desativado e ERP via API'
    $servico = Get-Service -Name $SERVICO_CONECTOR -ErrorAction SilentlyContinue
    if ($servico) {
        if ($servico.Status -ne 'Stopped') { Stop-Service $SERVICO_CONECTOR -Force }
        Set-Service -Name $SERVICO_CONECTOR -StartupType Disabled
        Ok 'servico do Conector parado e desativado'
    } else { Ok 'servico do Conector nao esta instalado' }

    New-Item -ItemType Directory -Force -Path $PASTA_API | Out-Null
    Copy-Item -Path (Join-Path $kit 'erp-via-api\*') -Destination $PASTA_API -Recurse -Force
    $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (-not (Test-Path $npm)) { $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source }
    if (-not $npm) { Falha 'Nao achei o Node.js (npm.cmd). Feche e abra o PowerShell como administrador e rode de novo.' }
    Push-Location $PASTA_API
    try {
        & $npm install --omit=dev --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) { Falha 'O npm nao conseguiu instalar o driver do SQL Server (mssql). Confira a internet e rode de novo.' }
    } finally { Pop-Location }
    Ok "ERP via API em $PASTA_API"

    . (Join-Path $PASTA_API 'Macuxi-Credencial.ps1')
    # usuario-api.sql tambem desabilita o login macuxi_conector: o pedido so entra por esta credencial.
    Gravar-Credencial $CREDENCIAL_SENHA_API (Trocar-Senha-Login 'usuario-api.sql')
    Ok 'login macuxi_api pronto e login do Conector desabilitado'
    if ($TrocarChave -or -not (Ler-Credencial $CREDENCIAL_CHAVE_API)) {
        Gravar-Credencial $CREDENCIAL_CHAVE_API (PedirChave 'thathyany-api')
        Ok 'chave guardada no Gerenciador de Credenciais'
    } else { Ok 'chave ja estava guardada (use -TrocarChave para trocar)' }

    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PASTA_API 'executar.ps1')`""
    $gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $config = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    [void](Register-ScheduledTask -TaskName $TAREFA_API -Action $acao -Trigger $gatilho -Settings $config -Principal $principal -Description 'Macuxi thathyany: envia a carga da ERP_THATHYANY pela API e grava os pedidos de volta (a cada minuto).' -Force)
    Enable-ScheduledTask -TaskName $TAREFA_API | Out-Null
    Start-ScheduledTask -TaskName $TAREFA_API
    Ok "tarefa ""$TAREFA_API"" ligada (roda a cada minuto)"
}

# ---------------------------------------------------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------------------------------------------------
Write-Host "Kit da thathyany - fase $Fase" -ForegroundColor Cyan
Detectar-Instancia
Passo-Programas
Passo-Sql
Passo-Banco
if ($Fase -eq 'Conector') { Passo-Conector } else { Passo-Api }
Titulo 'Pronto'
Write-Host '  Proximo passo: o ROTEIRO.md, na fase que voce acabou de instalar.'
