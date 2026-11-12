# Escolhe a pasta do Drive (Google Drive, OneDrive, Dropbox...) em que os dados do sistema ficam guardados
# e reinicia o sistema usando essa pasta. Rode em cada computador que for usar o sistema:
#   botão direito no arquivo > "Executar com o PowerShell"
#   ou, no terminal:  powershell -ExecutionPolicy Bypass -File conectar-drive.ps1
# Para desconectar:   powershell -ExecutionPolicy Bypass -File conectar-drive.ps1 -Desconectar

param(
  [string]$Pasta = "",
  [switch]$Desconectar
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not $Desconectar -and $Pasta -eq "") {
  Add-Type -AssemblyName System.Windows.Forms
  $janela = New-Object System.Windows.Forms.FolderBrowserDialog
  $janela.Description = "Escolha a pasta do Drive em que os dados do sistema financeiro vao ficar"
  $janela.ShowNewFolderButton = $true
  if ($janela.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Nenhuma pasta escolhida. Nada foi alterado."
    exit 0
  }
  $Pasta = $janela.SelectedPath
}

if (-not $Desconectar) {
  if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) {
    Write-Host "A pasta nao existe: $Pasta"
    exit 1
  }
  # Confere se da para gravar na pasta.
  $teste = Join-Path $Pasta ".teste-financas-pessoais"
  try {
    Set-Content -LiteralPath $teste -Value "ok" -Encoding ascii
    Remove-Item -LiteralPath $teste -Force
  } catch {
    Write-Host "Nao consegui gravar na pasta: $Pasta"
    exit 1
  }
  if ($Pasta -match '^[A-Za-z]:\\?$') {
    Write-Host "Escolha uma pasta dentro do Drive (por exemplo 'Meu Drive\Financas'), nao a unidade inteira."
    exit 1
  }
}

# Grava PASTA_DRIVE no .env sem mexer nas outras linhas.
$envArquivo = Join-Path $PSScriptRoot ".env"
$linhas = @()
if (Test-Path -LiteralPath $envArquivo) {
  $linhas = @(Get-Content -LiteralPath $envArquivo -Encoding utf8 | Where-Object { $_ -notmatch '^\s*PASTA_DRIVE\s*=' })
}
if (-not $Desconectar) {
  # Barras normais: funcionam no Docker e nao precisam de escape.
  $linhas += "PASTA_DRIVE=" + ($Pasta -replace '\\', '/')
}
$semBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($envArquivo, [string[]]$linhas, $semBom)

if ($Desconectar) {
  Write-Host "Drive desconectado. Os dados continuam neste computador e os arquivos da pasta nao foram apagados."
} else {
  Write-Host "Pasta do Drive: $Pasta"
}

Write-Host "Reiniciando o sistema..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "O Docker nao conseguiu usar essa pasta. Se ela fica numa unidade virtual do Google Drive (G:),"
  Write-Host "troque o Google Drive para o modo 'Espelhar arquivos' ou escolha uma pasta que exista de verdade no disco."
  exit 1
}
Write-Host ""
Write-Host "Pronto. Abra o sistema e veja a tela Drive: em ate um minuto os dados sao enviados ou carregados."
