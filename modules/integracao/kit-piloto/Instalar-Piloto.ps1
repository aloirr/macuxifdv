<#
.SYNOPSIS
  Kit do piloto Macuxi FDV (T-0162): monta um ERP simulado (SQL Server 2022 Express, base ERP_PILOTO) neste computador e liga as duas
  empresas teste ao Macuxi: "Piloto Conector" (Conector instalado como servico) e "Piloto API" (tarefa agendada "ERP via API").

.DESCRIPTION
  Rode como administrador, no Windows PowerShell (nao no PowerShell 7). Pode rodar quantas vezes quiser: o que ja esta pronto e pulado,
  as planilhas sao recarregadas e so o que mudou e atualizado. Senhas e chaves: so Read-Host mascarado e Gerenciador de Credenciais do
  Windows; nada vai para arquivo ou log.

.PARAMETER Limpar
  Zera a ERP_PILOTO (cadastros e pedidos) depois de pedir confirmacao e termina. As planilhas ficam como estao.

.PARAMETER ComExemplo
  Preenche com dados de exemplo so as planilhas que ainda nao existem (planilha ja criada nao e alterada).

.PARAMETER Modalidade
  Ambas (padrao), Conector ou API.

.PARAMETER TrocarChaves
  Pede de novo as chaves do Hub, mesmo que ja existam.

.PARAMETER ConectorZip
  Pacote do Conector (conector-<versao>.zip). Padrao: o conector-*.zip ao lado deste script.
#>
#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch]$Limpar,
    [switch]$ComExemplo,
    [ValidateSet('Ambas', 'Conector', 'API')][string]$Modalidade = 'Ambas',
    [switch]$TrocarChaves,
    [string]$ConectorZip,
    [string]$Pasta = 'C:\MacuxiPiloto'
)

$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
Get-ChildItem -LiteralPath $kit -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
$BANCO = 'ERP_PILOTO'
$INSTANCIA = '.\SQLEXPRESS'
$PASTA_PLANILHAS = Join-Path $Pasta 'planilhas'
$PASTA_API = Join-Path $Pasta 'erp-via-api'
$PASTA_CONECTOR = 'C:\ProgramData\Macuxi\Conector'
$SERVICO_CONECTOR = 'MacuxiConector'
$TAREFA_API = 'ERP via API'
$REGEX_CHAVE = '^mxc_[A-Za-z0-9_-]{43}$'

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "   [atencao] $t" -ForegroundColor Yellow }
function Falha($t) { throw $t }

if ($PSVersionTable.PSEdition -ne 'Desktop') { Falha 'Abra o "Windows PowerShell" (o azul, versao 5.1) como administrador. O PowerShell 7 nao serve para este kit.' }

# ---------------------------------------------------------------------------------------------------------------------
# Utilitarios de segredo e de SQL
# ---------------------------------------------------------------------------------------------------------------------
function SenhaAleatoria {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ('Mx' + [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', '') + '9!').Replace('!', 'z')
}

function PedirChave($rotulo) {
    for ($i = 0; $i -lt 3; $i++) {
        $seguro = Read-Host -AsSecureString "Cole a chave da empresa teste '$rotulo' (comeca com mxc_; o texto fica oculto)"
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
        try { $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if ($chave -match $REGEX_CHAVE) { return $chave }
        Aviso 'Essa chave nao tem o formato certo (mxc_ e mais 43 caracteres). Copie de novo no portal.'
    }
    Falha 'Chave invalida tres vezes. Gere uma nova no portal e rode o instalador de novo.'
}

function Abrir-Sql([string]$banco = 'master') {
    $c = New-Object System.Data.SqlClient.SqlConnection("Server=$INSTANCIA;Database=$banco;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=15")
    $c.Open()
    $c
}

function Executar-Sql($conn, [string]$texto, [hashtable]$parametros = @{}) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $texto
    $cmd.CommandTimeout = 120
    foreach ($k in $parametros.Keys) { [void]$cmd.Parameters.AddWithValue("@$k", $parametros[$k]) }
    $cmd.ExecuteNonQuery()
}

function Consultar-Sql($conn, [string]$texto, [hashtable]$parametros = @{}) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $texto
    foreach ($k in $parametros.Keys) { [void]$cmd.Parameters.AddWithValue("@$k", $parametros[$k]) }
    $tabela = New-Object System.Data.DataTable
    [void](New-Object System.Data.SqlClient.SqlDataAdapter($cmd)).Fill($tabela)
    , $tabela
}

# Roda um arquivo .sql com lotes separados por GO. $troca: variaveis $(NOME) trocadas so na memoria.
function Executar-Arquivo-Sql($conn, [string]$arquivo, [hashtable]$troca = @{}) {
    $texto = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8
    foreach ($k in $troca.Keys) { $texto = $texto.Replace('$(' + $k + ')', [string]$troca[$k]) }
    foreach ($lote in [regex]::Split($texto, '(?im)^\s*GO\s*$')) {
        if ($lote.Trim().Length -gt 0) { [void](Executar-Sql $conn $lote) }
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
        Falha "O winget nao conseguiu instalar $nome ($id), codigo $LASTEXITCODE. Rode o instalador de novo; se repetir, instale $nome a mao e rode de novo."
    }
    Falha "O winget nao achou $nome. Atualize o 'Instalador de Aplicativo' na Microsoft Store e rode de novo."
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Programas
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Programas {
    Titulo '1. Programas (winget)'
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Falha 'O winget nao esta instalado. Atualize o "Instalador de Aplicativo" na Microsoft Store e rode de novo.' }
    Winget-Instalar @('Microsoft.SQLServer.2022.Express') 'SQL Server 2022 Express'
    Winget-Instalar @('Microsoft.SQLServerManagementStudio.22', 'Microsoft.SQLServerManagementStudio.21', 'Microsoft.SQLServerManagementStudio') 'SQL Server Management Studio (SSMS)'
    Winget-Instalar @('OpenJS.NodeJS.LTS') 'Node.js LTS'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    foreach ($modulo in 'SqlServer', 'ImportExcel') {
        if (Get-Module -ListAvailable -Name $modulo) { Ok "modulo $modulo ja instalado" }
        else {
            Write-Host "   instalando o modulo $modulo..." -ForegroundColor Gray
            if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) { [void](Install-PackageProvider -Name NuGet -Force -Scope AllUsers) }
            Install-Module -Name $modulo -Scope AllUsers -Force -AllowClobber -Repository PSGallery
            Ok "modulo $modulo instalado"
        }
    }
    Import-Module ImportExcel -ErrorAction Stop
}

# ---------------------------------------------------------------------------------------------------------------------
# 2. SQL Server: TCP 1433, autenticacao mista, firewall so da rede local
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Rede-Sql {
    Titulo '2. SQL Server: TCP 1433, autenticacao mista e firewall'
    $mapa = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' -ErrorAction Stop
    $idInstancia = $mapa.SQLEXPRESS
    if (-not $idInstancia) { Falha 'A instancia SQLEXPRESS nao foi encontrada. A instalacao do SQL Server Express nao terminou; rode o instalador de novo.' }
    $raiz = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$idInstancia\MSSQLServer"
    $tcp = "$raiz\SuperSocketNetLib\Tcp"
    $mudou = $false
    if ((Get-ItemProperty $raiz).LoginMode -ne 2) { Set-ItemProperty $raiz -Name LoginMode -Value 2; $mudou = $true }
    if ((Get-ItemProperty $tcp).Enabled -ne 1) { Set-ItemProperty $tcp -Name Enabled -Value 1; $mudou = $true }
    $ipAll = "$tcp\IPAll"
    $p = Get-ItemProperty $ipAll
    if ($p.TcpPort -ne '1433' -or $p.TcpDynamicPorts -ne '') { Set-ItemProperty $ipAll -Name TcpPort -Value '1433'; Set-ItemProperty $ipAll -Name TcpDynamicPorts -Value ''; $mudou = $true }
    if ($mudou) {
        Restart-Service -Name 'MSSQL$SQLEXPRESS' -Force
        Ok 'TCP 1433 e autenticacao mista ligados (servico reiniciado)'
    } else { Ok 'TCP 1433 e autenticacao mista ja estavam ligados' }
    $servico = Get-Service 'MSSQL$SQLEXPRESS'
    if ($servico.Status -ne 'Running') { Start-Service $servico }
    if ($servico.StartType -ne 'Automatic') { Set-Service 'MSSQL$SQLEXPRESS' -StartupType Automatic }
    for ($i = 0; $i -lt 30; $i++) {
        try { $c = Abrir-Sql; $c.Close(); break } catch { Start-Sleep -Seconds 2; if ($i -eq 29) { Falha "Nao consegui conectar no SQL Server: $($_.Exception.Message)" } }
    }
    $regra = 'Macuxi Piloto - SQL Server 1433 (rede local)'
    if (-not (Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue)) {
        [void](New-NetFirewallRule -DisplayName $regra -Direction Inbound -Protocol TCP -LocalPort 1433 -RemoteAddress LocalSubnet -Action Allow -Profile Private,Domain)
        Ok 'firewall: porta 1433 aberta so para a rede local'
    } else {
        # quem ja instalou antes tinha a regra em todos os perfis: corrige
        Set-NetFirewallRule -DisplayName $regra -Profile Private,Domain -RemoteAddress LocalSubnet
        Ok 'firewall: porta 1433 ja estava aberta so para a rede local'
    }
}

# ---------------------------------------------------------------------------------------------------------------------
# 3. Banco ERP_PILOTO: esquema, entrada de pedidos e usuarios restritos
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Banco {
    Titulo "3. Banco $BANCO"
    $sql = Join-Path $kit 'sql'
    $mestre = Abrir-Sql
    try {
        if ((Consultar-Sql $mestre 'SELECT DB_ID(@b) AS id' @{ b = $BANCO }).Rows[0].id -is [DBNull]) {
            [void](Executar-Sql $mestre "CREATE DATABASE [$BANCO]")
            Ok "banco $BANCO criado"
        } else { Ok "banco $BANCO ja existe" }
    } finally { $mestre.Close() }
    $conn = Abrir-Sql $BANCO
    try {
        Executar-Arquivo-Sql $conn (Join-Path $sql '01-erp-piloto.sql')
        Executar-Arquivo-Sql $conn (Join-Path $sql '02-entrada-pedido.sql')
        Executar-Arquivo-Sql $conn (Join-Path $sql '03-pedido-extensao.sql')
        Ok 'tabelas, views vw_macuxi_* e entrada de pedidos prontas'
        # So troca a senha de quem vai ser reconfigurado agora (senha vazia = o usuario fica como esta).
        # Sem o pacote do Conector nao da para guardar a senha nova dele: nao troca (o servico ja instalado continua com a senha que tem).
        $script:SenhaConector = if ($Modalidade -in 'Ambas', 'Conector' -and $script:ConectorZipAchado) { SenhaAleatoria } else { '' }
        $script:SenhaApi = if ($Modalidade -in 'Ambas', 'API') { SenhaAleatoria } else { '' }
        Executar-Arquivo-Sql $conn (Join-Path $sql '04-usuarios.sql') @{ SENHA_CONECTOR = $script:SenhaConector; SENHA_API = $script:SenhaApi }
        # A senha nova da API vai ao cofre logo na sequencia, antes de qualquer passo que possa falhar (npm, rede).
        if ($script:SenhaApi) {
            . (Join-Path $kit 'erp-via-api\Macuxi-Credencial.ps1')
            Gravar-Credencial 'Macuxi.Piloto/erp_senha_api' $script:SenhaApi
        }
        Ok 'usuarios restritos prontos'
    } finally { $conn.Close() }
}

# ---------------------------------------------------------------------------------------------------------------------
# 3b. Limpar
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Limpar {
    Titulo "Limpar a $BANCO"
    Write-Host "   Isto apaga TODOS os cadastros e pedidos da $BANCO. As planilhas nao sao apagadas: apague as linhas delas se nao quiser recarregar." -ForegroundColor Yellow
    if ((Read-Host 'Digite LIMPAR para confirmar') -cne 'LIMPAR') { Falha 'Nada foi apagado.' }
    $conn = Abrir-Sql $BANCO
    try {
        $tabelas = Consultar-Sql $conn "SELECT name FROM sys.tables WHERE name LIKE 'piloto[_]%' OR name LIKE 'macuxi[_]pedido%'"
        # itens e notas antes dos cabecalhos (chave estrangeira)
        $ordem = @($tabelas.Rows | ForEach-Object { $_.name } | Sort-Object { if ($_ -eq 'macuxi_pedido_entrada') { 1 } else { 0 } })
        foreach ($t in $ordem) { [void](Executar-Sql $conn "DELETE FROM dbo.[$t]") }
        Ok "$BANCO zerada ($($ordem.Count) tabelas)"
    } finally { $conn.Close() }
}

# ---------------------------------------------------------------------------------------------------------------------
# 4. Planilhas: gerar, importar e relatorio
# ---------------------------------------------------------------------------------------------------------------------
$PLANILHAS = [ordered]@{
    'filiais' = 'piloto_filial'; 'vendedores' = 'piloto_vendedor'; 'formas_pagamento' = 'piloto_forma_pagamento'
    'prazos_pagamento' = 'piloto_prazo_pagamento'; 'produtos' = 'piloto_produto'; 'clientes' = 'piloto_cliente'
    'precos' = 'piloto_preco'; 'estoque' = 'piloto_estoque'; 'titulos' = 'piloto_titulo'
}
$PADRAO_TEXTO = @{ ativo = 'S'; bloqueado = 'N'; cancelado = 'N' }

function Metadados-Tabela($conn, [string]$tabela) {
    $cols = Consultar-Sql $conn @"
SELECT c.COLUMN_NAME AS nome, c.DATA_TYPE AS tipo, c.CHARACTER_MAXIMUM_LENGTH AS tamanho, c.NUMERIC_PRECISION AS prec, c.NUMERIC_SCALE AS escala,
       c.IS_NULLABLE AS nulo, c.COLUMN_DEFAULT AS padrao
  FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = @t AND c.COLUMN_NAME NOT IN ('alterado_em', 'linha_hash') ORDER BY c.ORDINAL_POSITION
"@ @{ t = $tabela }
    $pk = Consultar-Sql $conn @"
SELECT k.COLUMN_NAME AS nome FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_NAME = t.TABLE_NAME
 WHERE t.TABLE_NAME = @t AND t.CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY k.ORDINAL_POSITION
"@ @{ t = $tabela }
    [pscustomobject]@{ Colunas = @($cols.Rows | ForEach-Object { [pscustomobject]@{ Nome = $_.nome; Tipo = $_.tipo; Tamanho = $_.tamanho; Prec = $_.prec; Escala = $_.escala; Obrigatoria = ($_.nulo -eq 'NO' -and $_.padrao -is [DBNull]) } }); Chave = @($pk.Rows | ForEach-Object { $_.nome }) }
}

function Chave-Texto($v) { if ($v -is [datetime]) { $v.ToString('yyyy-MM-dd') } else { [string]$v } }

function Valor-Vazio($v) { ($null -eq $v) -or (($v -is [string]) -and $v.Trim().Length -eq 0) }

# Converte a celula para o tipo da coluna. Devolve o valor (ou $null) e lanca texto em portugues quando nao serve.
function Converter-Celula($col, $v) {
    if (Valor-Vazio $v) {
        if ($PADRAO_TEXTO.ContainsKey($col.Nome)) { return $PADRAO_TEXTO[$col.Nome] }
        if ($col.Obrigatoria) { throw "campo '$($col.Nome)' e obrigatorio e esta vazio" }
        return $null
    }
    $inv = [Globalization.CultureInfo]::InvariantCulture
    switch ($col.Tipo) {
        { $_ -in 'varchar', 'char' } {
            $t = ([string]$v).Trim()
            if ($col.Tamanho -gt 0 -and $t.Length -gt $col.Tamanho) { throw "campo '$($col.Nome)' passa de $($col.Tamanho) caracteres" }
            if ($col.Nome -in 'ativo', 'bloqueado', 'cancelado') {
                $u = $t.ToUpperInvariant()
                if ($u -in 'S', 'SIM') { return 'S' } elseif ($u -in 'N', 'NAO') { return 'N' }
                throw "campo '$($col.Nome)' deve ser S ou N"
            }
            if ($col.Nome -eq 'uf' -or $col.Nome -like '*codigo*') { $t = $t.ToUpperInvariant() }
            return $t
        }
        'int' {
            $n = 0
            if ($v -is [double] -or $v -is [int] -or $v -is [decimal]) { $d = [decimal]$v } elseif ([decimal]::TryParse(([string]$v).Trim().Replace(',', '.'), [Globalization.NumberStyles]::Float, $inv, [ref]$n)) { $d = $n } else { throw "campo '$($col.Nome)' deve ser um numero inteiro" }
            if ($d -ne [math]::Floor($d)) { throw "campo '$($col.Nome)' deve ser inteiro (sem casas decimais)" }
            return [int]$d
        }
        'decimal' {
            $n = 0
            if ($v -is [double] -or $v -is [int] -or $v -is [decimal]) { $d = [decimal]$v } elseif ([decimal]::TryParse(([string]$v).Trim().Replace(',', '.'), [Globalization.NumberStyles]::Float, $inv, [ref]$n)) { $d = $n } else { throw "campo '$($col.Nome)' deve ser um numero (use virgula ou ponto nos centavos)" }
            $d = [math]::Round($d, [int]$col.Escala)
            if ([math]::Abs($d) -ge [decimal][math]::Pow(10, [int]$col.Prec - [int]$col.Escala)) { throw "campo '$($col.Nome)' esta grande demais" }
            return $d
        }
        'date' {
            if ($v -is [datetime]) { return $v.Date }
            if ($v -is [double]) { return [datetime]::FromOADate($v).Date }
            $dt = [datetime]::MinValue
            if ([datetime]::TryParseExact(([string]$v).Trim(), [string[]]@('dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd'), $inv, 'None', [ref]$dt)) { return $dt.Date }
            throw "campo '$($col.Nome)' deve ser uma data (dd/mm/aaaa)"
        }
        default { throw "tipo $($col.Tipo) nao tratado na coluna '$($col.Nome)'" }
    }
}

function Tipo-Sql($col) {
    switch ($col.Tipo) { 'int' { 'Int' } 'decimal' { 'Decimal' } 'date' { 'Date' } 'char' { 'Char' } default { 'VarChar' } }
}

function Parametro($cmd, [string]$nome, $col, $valor) {
    $p = $cmd.Parameters.Add("@$nome", [System.Data.SqlDbType](Tipo-Sql $col))
    if ($col.Tipo -eq 'decimal') { $p.Precision = [byte]$col.Prec; $p.Scale = [byte]$col.Escala }
    if ($null -eq $valor) { $p.Value = [DBNull]::Value } else { $p.Value = $valor }
}

function Gerar-Planilha([string]$arquivo, $meta, $exemplo) {
    $pkg = Open-ExcelPackage -Path $arquivo -Create
    try {
        $ws = $pkg.Workbook.Worksheets.Add('dados')
        for ($i = 0; $i -lt $meta.Colunas.Count; $i++) {
            $ws.Cells[1, $i + 1].Value = $meta.Colunas[$i].Nome
            $ws.Cells[1, $i + 1].Style.Font.Bold = $true
            if ($meta.Colunas[$i].Tipo -eq 'date') { $ws.Column($i + 1).Style.Numberformat.Format = 'dd/mm/yyyy' }
            if ($meta.Colunas[$i].Tipo -eq 'char' -or $meta.Colunas[$i].Tipo -eq 'varchar') { $ws.Column($i + 1).Style.Numberformat.Format = '@' }
            $ws.Column($i + 1).Width = 18
        }
        $ws.View.FreezePanes(2, 1)
        if ($exemplo) {
            $linha = 2
            foreach ($registro in $exemplo) {
                for ($i = 0; $i -lt $meta.Colunas.Count; $i++) {
                    $nome = $meta.Colunas[$i].Nome
                    $valor = $registro.$nome
                    if ($null -ne $valor) {
                        if ($meta.Colunas[$i].Tipo -eq 'date') { $valor = [datetime]::ParseExact([string]$valor, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) }
                        $ws.Cells[$linha, $i + 1].Value = $valor
                    }
                }
                $linha++
            }
        }
        $guia = $pkg.Workbook.Worksheets.Add('colunas')
        $guia.Cells[1, 1].Value = 'coluna'; $guia.Cells[1, 2].Value = 'tipo'; $guia.Cells[1, 3].Value = 'obrigatoria'; $guia.Cells[1, 4].Value = 'chave'
        for ($i = 0; $i -lt $meta.Colunas.Count; $i++) {
            $c = $meta.Colunas[$i]
            $guia.Cells[$i + 2, 1].Value = $c.Nome
            $guia.Cells[$i + 2, 2].Value = $c.Tipo + $(if ($c.Tamanho -gt 0) { "($($c.Tamanho))" } else { '' })
            $guia.Cells[$i + 2, 3].Value = $(if ($c.Obrigatoria) { 'sim' } else { 'nao' })
            $guia.Cells[$i + 2, 4].Value = $(if ($meta.Chave -contains $c.Nome) { 'sim' } else { '' })
        }
        $guia.Cells[1, 1, 1, 4].Style.Font.Bold = $true
    } finally { Close-ExcelPackage $pkg }
}

function Importar-Planilha($conn, [string]$arquivo, [string]$tabela, $meta) {
    $r = [ordered]@{ Lidas = 0; Novas = 0; Atualizadas = 0; SemMudanca = 0; Desativadas = 0; Recusadas = New-Object System.Collections.Generic.List[string] }
    try { $linhas = @(Import-Excel -Path $arquivo -WorksheetName 'dados' -ErrorAction Stop) }
    catch { $r.Recusadas.Add("planilha: nao consegui abrir ($($_.Exception.Message.Split([char]10)[0])). Feche-a no Excel e rode de novo."); return [pscustomobject]$r }
    if ($linhas.Count -gt 0) {
        $presentes = @($linhas[0].PSObject.Properties.Name)
        $faltam = @($meta.Colunas | Where-Object { $_.Obrigatoria -and ($presentes -notcontains $_.Nome) } | ForEach-Object { $_.Nome })
        if ($faltam.Count -gt 0) { $r.Recusadas.Add("planilha: faltam as colunas $($faltam -join ', ') no cabecalho (linha 1). Nada foi importado."); return [pscustomobject]$r }
    }
    $vistos = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $n = 1
    foreach ($linha in $linhas) {
        $n++
        if (@($linha.PSObject.Properties | Where-Object { -not (Valor-Vazio $_.Value) }).Count -eq 0) { continue }
        $r.Lidas++
        try {
            $valores = @{}
            foreach ($col in $meta.Colunas) { $valores[$col.Nome] = Converter-Celula $col $linha.($col.Nome) }
            $chave = ($meta.Chave | ForEach-Object { Chave-Texto $valores[$_] }) -join '|'
            if (-not $vistos.Add($chave)) { throw "chave repetida na planilha ($($meta.Chave -join ', '))" }
            $canon = ($meta.Colunas | ForEach-Object { "$($_.Nome)=$(if ($null -eq $valores[$_.Nome]) { '' } elseif ($valores[$_.Nome] -is [datetime]) { $valores[$_.Nome].ToString('yyyy-MM-dd') } else { [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $valores[$_.Nome]) })" }) -join '|'
            $hash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($canon))) -replace '-', '').ToLowerInvariant()

            $onde = ($meta.Chave | ForEach-Object { "[$_] = @k_$_" }) -join ' AND '
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT linha_hash FROM dbo.[$tabela] WHERE $onde"
            foreach ($k in $meta.Chave) { Parametro $cmd "k_$k" ($meta.Colunas | Where-Object Nome -eq $k) $valores[$k] }
            $atual = $cmd.ExecuteScalar()
            if ($null -ne $atual -and $atual -eq $hash) { $r.SemMudanca++; continue }

            $cmd = $conn.CreateCommand()
            $outras = @($meta.Colunas | Where-Object { $meta.Chave -notcontains $_.Nome })
            if ($null -eq $atual) {
                $nomes = ($meta.Colunas | ForEach-Object { "[$($_.Nome)]" }) -join ', '
                $params = ($meta.Colunas | ForEach-Object { "@v_$($_.Nome)" }) -join ', '
                $cmd.CommandText = "INSERT INTO dbo.[$tabela] ($nomes, linha_hash) VALUES ($params, @hash)"
            } else {
                $sets = ($outras | ForEach-Object { "[$($_.Nome)] = @v_$($_.Nome)" }) -join ', '
                $cmd.CommandText = "UPDATE dbo.[$tabela] SET $sets, linha_hash = @hash, alterado_em = SYSUTCDATETIME() WHERE $onde"
                foreach ($k in $meta.Chave) { Parametro $cmd "k_$k" ($meta.Colunas | Where-Object Nome -eq $k) $valores[$k] }
            }
            $alvo = if ($null -eq $atual) { $meta.Colunas } else { $outras }
            foreach ($col in $alvo) { Parametro $cmd "v_$($col.Nome)" $col $valores[$col.Nome] }
            [void]$cmd.Parameters.AddWithValue('@hash', $hash)
            [void]$cmd.ExecuteNonQuery()
            if ($null -eq $atual) { $r.Novas++ } else { $r.Atualizadas++ }
        } catch {
            $m = $_.Exception.Message.Split([char]10)[0].Trim()
            if ($m -match 'CHECK constraint') { $m = 'valor fora do formato permitido (confira S/N e, nos prazos, so numeros separados por virgula)' }
            elseif ($m -match 'PRIMARY KEY|duplicate key') { $m = 'chave repetida no banco' }
            $r.Recusadas.Add("linha ${n}: $m")
        }
    }
    # Quem saiu da planilha vira inativo (o Macuxi inativa no proximo envio); nada e apagado.
    $existentes = Consultar-Sql $conn "SELECT $((($meta.Chave | ForEach-Object { "[$_]" }) -join ', ')) FROM dbo.[$tabela] WHERE ativo = 'S'"
    if ($r.Recusadas.Count -eq 0) {
        foreach ($row in $existentes.Rows) {
            $chaveBanco = ($meta.Chave | ForEach-Object { Chave-Texto $row[$_] }) -join '|'
            if ($vistos.Contains($chaveBanco)) { continue }
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "UPDATE dbo.[$tabela] SET ativo = 'N', alterado_em = SYSUTCDATETIME(), linha_hash = NULL WHERE " + (($meta.Chave | ForEach-Object { "[$_] = @k_$_" }) -join ' AND ')
            foreach ($k in $meta.Chave) { Parametro $cmd "k_$k" ($meta.Colunas | Where-Object Nome -eq $k) $row[$k] }
            [void]$cmd.ExecuteNonQuery()
            $r.Desativadas++
        }
    }
    [pscustomobject]$r
}

function Passo-Planilhas {
    Titulo "4. Planilhas em $PASTA_PLANILHAS"
    New-Item -ItemType Directory -Force -Path $PASTA_PLANILHAS | Out-Null
    $exemplos = $null
    $arqExemplo = Join-Path $kit 'dados-exemplo.json'
    if ($ComExemplo -and (Test-Path $arqExemplo)) { $exemplos = Get-Content -LiteralPath $arqExemplo -Raw -Encoding UTF8 | ConvertFrom-Json }
    $conn = Abrir-Sql $BANCO
    $relatorio = @()
    try {
        foreach ($nome in $PLANILHAS.Keys) {
            $tabela = $PLANILHAS[$nome]
            $arquivo = Join-Path $PASTA_PLANILHAS "$nome.xlsx"
            $meta = Metadados-Tabela $conn $tabela
            if (-not (Test-Path $arquivo)) {
                $dadosEx = $null
                if ($exemplos -and $exemplos.PSObject.Properties.Name -contains $nome) { $dadosEx = $exemplos.$nome }
                Gerar-Planilha $arquivo $meta $dadosEx
                Ok "planilha criada: $nome.xlsx$(if ($dadosEx) { ' (com dados de exemplo)' } else { ' (vazia, so os cabecalhos)' })"
            }
            $res = Importar-Planilha $conn $arquivo $tabela $meta
            $relatorio += [pscustomobject]@{ Planilha = "$nome.xlsx"; Resultado = $res }
        }
    } finally { $conn.Close() }

    Write-Host ""
    Write-Host '   RELATORIO DAS PLANILHAS' -ForegroundColor Cyan
    Write-Host ('   {0,-22} {1,7} {2,11} {3,12} {4,11} {5,9}' -f 'planilha', 'novas', 'atualizadas', 'sem mudanca', 'desativadas', 'recusadas')
    foreach ($item in $relatorio) {
        $x = $item.Resultado
        Write-Host ('   {0,-22} {1,7} {2,11} {3,12} {4,11} {5,9}' -f $item.Planilha, $x.Novas, $x.Atualizadas, $x.SemMudanca, $x.Desativadas, $x.Recusadas.Count)
    }
    $recusas = @($relatorio | Where-Object { $_.Resultado.Recusadas.Count -gt 0 })
    foreach ($item in $recusas) {
        Write-Host ""
        Write-Host "   Recusadas em $($item.Planilha):" -ForegroundColor Yellow
        foreach ($m in $item.Resultado.Recusadas) { Write-Host "     - $m" -ForegroundColor Yellow }
    }
    if ($recusas.Count -gt 0) { Aviso 'Corrija as linhas recusadas na planilha e rode o instalador de novo.' }
}

# ---------------------------------------------------------------------------------------------------------------------
# 5. Modalidade CONECTOR (empresa teste "Piloto Conector")
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
    if (-not $ConectorZip) {
        $achado = Get-ChildItem -Path $kit -Filter 'conector-*.zip' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
        if ($achado) { $ConectorZip = $achado.FullName }
    }
    if ($ConectorZip -and (Test-Path $ConectorZip)) { return $ConectorZip }
    return $null
}

function Passo-Conector {
    Titulo '5. Modalidade CONECTOR (empresa teste "Piloto Conector")'
    if (-not $script:ConectorZipAchado) {
        Aviso 'O pacote do Conector (conector-<versao>.zip) nao esta ao lado do instalador. Copie-o para a pasta do kit ou use -ConectorZip e rode de novo.'
        return
    }
    $ConectorZip = $script:ConectorZipAchado
    $existe = Get-Service -Name $SERVICO_CONECTOR -ErrorAction SilentlyContinue
    if ($existe -and $existe.Status -eq 'Running') { Stop-Service $SERVICO_CONECTOR -Force }
    New-Item -ItemType Directory -Force -Path $PASTA_CONECTOR | Out-Null
    Expand-Archive -LiteralPath $ConectorZip -DestinationPath $PASTA_CONECTOR -Force
    Copy-Item -LiteralPath (Join-Path $kit 'conector\conector.json') -Destination (Join-Path $PASTA_CONECTOR 'conector.json') -Force
    Ok "Conector em $PASTA_CONECTOR"

    $node = Join-Path $PASTA_CONECTOR 'node.exe'
    $conf = Join-Path $PASTA_CONECTOR 'conector.json'
    Push-Location $PASTA_CONECTOR
    try {
        $script:SenhaConector | & $node 'conector.mjs' 'segredo' 'definir' 'erp_senha' '--config' $conf | Out-Null
        if ($LASTEXITCODE -ne 0) { Falha 'O Conector nao guardou a senha do banco no Gerenciador de Credenciais.' }
        $temChave = $false
        if (-not $TrocarChaves -and $existe) { $temChave = $true }
        if (-not $temChave) {
            $chave = PedirChave 'Piloto Conector'
            $chave | & $node 'conector.mjs' 'segredo' 'definir' 'hub_chave' '--config' $conf | Out-Null
            if ($LASTEXITCODE -ne 0) { Falha 'O Conector nao guardou a chave do Hub.' }
            $chave = $null
            Ok 'chave do Hub guardada'
        } else { Ok 'chave do Hub ja estava guardada (use -TrocarChaves para trocar)' }

        & $node 'conector.mjs' 'validar-config' '--config' $conf
        if ($LASTEXITCODE -ne 0) { Falha 'O conector.json nao passou na validacao.' }
        if (-not $existe) {
            & $node 'conector.mjs' 'instalar-servico' '--winsw' (Join-Path $PASTA_CONECTOR 'WinSW-x64.exe') '--config' $conf
            if ($LASTEXITCODE -ne 0) { Falha 'Nao consegui instalar o servico do Conector.' }
            Ok 'servico "Macuxi Conector" instalado'
        } else { Ok 'servico "Macuxi Conector" ja instalado' }
    } finally { Pop-Location }

    # O Gerenciador de Credenciais e por usuario: o servico precisa rodar na conta que guardou os segredos.
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
        else { Ok 'servico configurado para rodar na sua conta' }
    }
    Set-Service -Name $SERVICO_CONECTOR -StartupType Automatic
    try { Start-Service -Name $SERVICO_CONECTOR; Ok 'servico iniciado' } catch { Aviso "Nao consegui iniciar o servico agora: $($_.Exception.Message.Split([char]10)[0]). Veja o roteiro, secao Se der errado." }
}

# ---------------------------------------------------------------------------------------------------------------------
# 6. Modalidade API (empresa teste "Piloto API"): tarefa agendada "ERP via API"
# ---------------------------------------------------------------------------------------------------------------------
function Passo-Api {
    Titulo '6. Modalidade API (empresa teste "Piloto API")'
    New-Item -ItemType Directory -Force -Path $PASTA_API | Out-Null
    Copy-Item -Path (Join-Path $kit 'erp-via-api\*') -Destination $PASTA_API -Recurse -Force
    $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (-not (Test-Path $npm)) { Falha 'Nao achei o Node.js em Program Files. Feche e abra o PowerShell como administrador e rode de novo.' }
    . (Join-Path $PASTA_API 'Macuxi-Credencial.ps1')
    $versaoPedida = (Get-Content -LiteralPath (Join-Path $PASTA_API 'package.json') -Raw | ConvertFrom-Json).dependencies.mssql
    $pacoteMssql = Join-Path $PASTA_API 'node_modules\mssql\package.json'
    $versaoInstalada = if (Test-Path $pacoteMssql) { (Get-Content -LiteralPath $pacoteMssql -Raw | ConvertFrom-Json).version } else { $null }
    if ($versaoInstalada -and $versaoInstalada -eq $versaoPedida) {
        Ok "driver mssql $versaoInstalada ja instalado"
    } else {
        Push-Location $PASTA_API
        try {
            & $npm install --omit=dev --no-audit --no-fund --loglevel=error
            if ($LASTEXITCODE -ne 0) { Falha 'O npm nao conseguiu instalar o driver do SQL Server (mssql). Confira a internet e rode de novo.' }
        } finally { Pop-Location }
        Ok 'ERP via API copiado e dependencias instaladas'
    }
    if ($TrocarChaves -or -not (Ler-Credencial 'Macuxi.Piloto/hub_chave_api')) {
        Gravar-Credencial 'Macuxi.Piloto/hub_chave_api' (PedirChave 'Piloto API')
        Ok 'chave do Hub guardada'
    } else { Ok 'chave do Hub ja estava guardada (use -TrocarChaves para trocar)' }

    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PASTA_API 'executar.ps1')`""
    $gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $config = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    [void](Register-ScheduledTask -TaskName $TAREFA_API -Action $acao -Trigger $gatilho -Settings $config -Principal $principal -Description 'Macuxi Piloto API: envia a carga da ERP_PILOTO ao Hub e grava os pedidos de volta (a cada minuto).' -Force)
    Ok "tarefa agendada ""$TAREFA_API"" criada"
    Start-ScheduledTask -TaskName $TAREFA_API
}

# ---------------------------------------------------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------------------------------------------------
Write-Host 'Kit do piloto Macuxi FDV' -ForegroundColor Cyan
if ($Limpar) {
    Passo-Limpar
    Write-Host ''
    Write-Host 'Para recarregar as planilhas, rode o instalador de novo sem -Limpar.'
    return
}
Passo-Programas
Passo-Rede-Sql
$script:ConectorZipAchado = Achar-ConectorZip
Passo-Banco
Passo-Planilhas
if ($Modalidade -in 'Ambas', 'Conector') { Passo-Conector }
if ($Modalidade -in 'Ambas', 'API') { Passo-Api }
$script:SenhaConector = $null
$script:SenhaApi = $null

Titulo 'Pronto'
Write-Host "  Proximo passo: secao Usar do ROTEIRO.md."
