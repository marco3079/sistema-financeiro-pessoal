# Traz as carteiras recomendadas da Suno para o sistema (ver sincronizar.mjs).
# Uso: powershell -ExecutionPolicy Bypass -File ferramentas\suno\sincronizar-suno.ps1
# Precisa do Node.js 18 ou mais novo e do Google Chrome instalados.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'O Node.js nao foi encontrado. Instale em https://nodejs.org (versao LTS) e rode de novo.'
    exit 2
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\playwright-core'))) {
    Write-Host 'Primeira vez: instalando o controlador do navegador (playwright-core, sem baixar navegador)...'
    & npm install --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Nao foi possivel instalar as dependencias.'
        exit 3
    }
}

& node (Join-Path $PSScriptRoot 'sincronizar.mjs')
exit $LASTEXITCODE
