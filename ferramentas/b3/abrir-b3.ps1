# Aberto pelo link financas-b3:// (botao "Atualizar pela B3" no alto da Carteira). Ver automatizar.mjs.
# O link e registrado no Windows pelo instalador (ou pelo registrar-b3.ps1).
# Precisa do Node.js 18 ou mais novo e do Google Chrome instalados (nao instala nada).
param([string]$Link = '')

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Financas: atualizacao pela B3'
Set-Location -LiteralPath $PSScriptRoot
# Registro da ultima execucao (sem a senha da tarefa), para entender quando algo nao abre.
try {
    $registro = Join-Path $env:TEMP 'financas-b3-ultima.log'
    Set-Content -LiteralPath $registro -Encoding UTF8 -Value ((Get-Date -Format s) + ' iniciado: ' + ($Link -replace 'token=[^&]*', 'token=***'))
} catch { }

function Fim([int]$Codigo, [int]$Segundos) {
    if ($Codigo -ne 0) { Write-Host "`nEsta janela fecha em $Segundos segundos." }
    Start-Sleep -Seconds $Segundos
    exit $Codigo
}

if ($Link -notmatch '^financas-b3://') {
    Write-Host 'Abra pelo botao "Atualizar pela B3" no sistema (no alto da pagina Carteira).'
    Fim 1 15
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'O Node.js nao foi encontrado. Instale em https://nodejs.org (versao LTS) e tente de novo.'
    Fim 2 30
}

& node (Join-Path $PSScriptRoot 'automatizar.mjs') $Link
if ($LASTEXITCODE -ne 0) { Fim $LASTEXITCODE 20 }
Fim 0 4
