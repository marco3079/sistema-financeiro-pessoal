# Registra (uma vez so) o link financas-b3:// no usuario do Windows, para o botao "Atualizar pela B3" do sistema
# abrir o Chrome neste computador. Grava so em HKEY_CURRENT_USER\Software\Classes\financas-b3 (nao precisa de
# administrador). O link abre o abrir-b3.ps1 desta pasta.
#
# Uso:     powershell -ExecutionPolicy Bypass -File ferramentas\b3\registrar-b3.ps1
# Remover: powershell -ExecutionPolicy Bypass -File ferramentas\b3\registrar-b3.ps1 -Remover
param([switch]$Remover, [switch]$Silencioso)

$ErrorActionPreference = 'Stop'
$Chave = 'HKCU:\Software\Classes\financas-b3'

if ($Remover) {
    if (Test-Path -LiteralPath $Chave) { Remove-Item -LiteralPath $Chave -Recurse -Force }
    Write-Host 'Link financas-b3:// removido deste usuario do Windows.'
    exit 0
}

$Script = Join-Path $PSScriptRoot 'abrir-b3.ps1'
if (-not (Test-Path -LiteralPath $Script)) {
    Write-Host "Nao achei $Script."
    exit 1
}
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Comando = '"' + $PowerShell + '" -NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" "%1"'

New-Item -Path $Chave -Force | Out-Null
Set-Item -LiteralPath $Chave -Value 'URL:Financas B3'
Set-ItemProperty -LiteralPath $Chave -Name 'URL Protocol' -Value ''
New-Item -Path "$Chave\shell\open\command" -Force | Out-Null
Set-Item -LiteralPath "$Chave\shell\open\command" -Value $Comando

if ($Silencioso) { return }
Write-Host 'Pronto: o link financas-b3:// abre o script da B3 deste computador.'
Write-Host 'No sistema, va em Carteira e clique em "Atualizar pela B3" (no alto da pagina).'
Write-Host 'Na primeira vez o navegador pergunta se pode abrir o PowerShell: confirme.'
