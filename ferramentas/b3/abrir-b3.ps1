# Aberto pelo link financas-b3:// (botao "Atualizar pela B3" em Carteira > Proventos). Ver automatizar.mjs.
# O link e registrado no Windows uma vez so, pelo registrar-b3.ps1.
# Precisa do Node.js 18 ou mais novo e do Google Chrome instalados.
param([string]$Link = '')

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Financas: atualizacao pela B3'
Set-Location -LiteralPath $PSScriptRoot

function Fim([int]$Codigo, [int]$Segundos) {
    if ($Codigo -ne 0) { Write-Host "`nEsta janela fecha em $Segundos segundos." }
    Start-Sleep -Seconds $Segundos
    exit $Codigo
}

if ($Link -notmatch '^financas-b3://') {
    Write-Host 'Abra pelo botao "Atualizar pela B3" no sistema (Carteira > Proventos).'
    Fim 1 15
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'O Node.js nao foi encontrado. Instale em https://nodejs.org (versao LTS) e tente de novo.'
    Fim 2 30
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\playwright-core'))) {
    Write-Host 'Primeira vez: instalando o controlador do navegador (playwright-core, sem baixar navegador)...'
    & npm install --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Nao foi possivel instalar as dependencias.'
        Fim 3 30
    }
}

& node (Join-Path $PSScriptRoot 'automatizar.mjs') $Link
if ($LASTEXITCODE -ne 0) { Fim $LASTEXITCODE 20 }
Fim 0 4
