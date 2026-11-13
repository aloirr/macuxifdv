# T-0162 — roda uma passada do "ERP via API" (chamado pela tarefa agendada "ERP via API", a cada minuto).
# Lê a chave do Hub e a senha da ERP_PILOTO do Gerenciador de Credenciais (conta de quem instalou) e as entrega só ao processo do Node.
$ErrorActionPreference = 'Stop'
$pasta = $PSScriptRoot
. (Join-Path $pasta 'Macuxi-Credencial.ps1')

$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }

$env:MACUXI_CHAVE = Ler-Credencial 'Macuxi.Piloto/hub_chave_api'
$env:MACUXI_ERP_SENHA = Ler-Credencial 'Macuxi.Piloto/erp_senha_api'
if (-not $env:MACUXI_CHAVE -or -not $env:MACUXI_ERP_SENHA) {
    Add-Content -Path (Join-Path $pasta 'erp-via-api.log') -Value "$(Get-Date -Format s) ERRO: falta a chave ou a senha no Gerenciador de Credenciais. Rode o Instalar-Piloto.ps1 de novo."
    exit 1
}
try {
    # No PowerShell 5.1, stderr do node com 'Stop' vira erro terminante e não chega ao log: aqui é 'Continue'.
    $ErrorActionPreference = 'Continue'
    & $node (Join-Path $pasta 'executar.mjs') @args *>> (Join-Path $pasta 'erp-via-api.log')
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:\MACUXI_CHAVE, Env:\MACUXI_ERP_SENHA -ErrorAction SilentlyContinue
}
