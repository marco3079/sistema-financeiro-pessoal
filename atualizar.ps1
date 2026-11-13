# Atualiza o sistema para o ultimo commit do repositorio no GitHub.
#
#   atualizar.ps1               atualiza agora (copia do banco, git pull, reconstroi os conteineres)
#   atualizar.ps1 -Instalar     liga o botao "Atualizar" da tela: cria uma tarefa do Windows que fica esperando
#                               o pedido da tela e roda a atualizacao. A tarefa so sabe fazer isso.
#   atualizar.ps1 -Desinstalar  remove a tarefa
#   atualizar.ps1 -Vigiar       (uso interno da tarefa) espera pedidos da tela
#
# Para rodar: botao direito > "Executar com o PowerShell", ou
#   powershell -ExecutionPolicy Bypass -File atualizar.ps1

param(
  [switch]$Instalar,
  [switch]$Desinstalar,
  [switch]$Vigiar
)

$ErrorActionPreference = "Stop"
$Raiz = $PSScriptRoot
Set-Location -Path $Raiz

$NomeDaTarefa = "FinancasPessoais-Atualizador"
$Pasta = Join-Path $Raiz "atualizacao"     # pasta que o sistema enxerga (montada no conteiner)
$ArquivoPedido = Join-Path $Pasta "pedido.json"
$ArquivoEstado = Join-Path $Pasta "estado.json"
$ArquivoVersao = Join-Path $Pasta "versao.json"
$PastaBackups = Join-Path $Raiz "backups"
$SemBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $Pasta)) { New-Item -ItemType Directory -Path $Pasta | Out-Null }

function Gravar-Json([string]$Arquivo, $Objeto) {
  $temporario = "$Arquivo.tmp"
  [System.IO.File]::WriteAllText($temporario, ($Objeto | ConvertTo-Json -Depth 5), $SemBom)
  Move-Item -LiteralPath $temporario -Destination $Arquivo -Force
}

function Agora { return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

function Gravar-Estado([string]$Situacao, [string]$Mensagem) {
  Gravar-Json $ArquivoEstado @{ situacao = $Situacao; mensagem = $Mensagem; em = (Agora); vigiaVistoEm = (Agora) }
}

# Roda um programa e devolve a saida como texto; falha vira excecao com a saida junto.
function Rodar([string]$Programa, [string[]]$Argumentos) {
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $saida = & $Programa @Argumentos 2>&1 | ForEach-Object { "$_" }
  } finally {
    $ErrorActionPreference = $anterior
  }
  if ($LASTEXITCODE -ne 0) {
    $fim = ($saida | Select-Object -Last 6) -join " | "
    throw "$Programa $($Argumentos -join ' ') falhou: $fim"
  }
  return ($saida -join "`n")
}

# Grava em atualizacao/versao.json o commit que esta instalado, para a tela comparar com o GitHub.
function Gravar-Versao {
  $commit = (Rodar "git" @("rev-parse", "HEAD")).Trim()
  $data = (Rodar "git" @("log", "-1", "--format=%cI")).Trim()
  $mensagem = (Rodar "git" @("log", "-1", "--format=%s")).Trim()
  $ramo = (Rodar "git" @("rev-parse", "--abbrev-ref", "HEAD")).Trim()
  $origem = (Rodar "git" @("remote", "get-url", "origin")).Trim()
  $repositorio = ""
  if ($origem -match 'github\.com[:/]+([^/]+/[^/]+?)(\.git)?/?$') { $repositorio = $Matches[1] }
  Gravar-Json $ArquivoVersao @{ commit = $commit; data = $data; mensagem = $mensagem; ramo = $ramo; repositorio = $repositorio; gravadoEm = (Agora) }
}

# Copia do banco antes de atualizar: backups/financas-AAAAMMDD-HHMMSS.sql (ficam as 5 mais recentes).
function Copiar-Banco {
  if (-not (Test-Path -LiteralPath $PastaBackups)) { New-Item -ItemType Directory -Path $PastaBackups | Out-Null }
  $nome = "financas-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql"
  Rodar "docker" @("compose", "exec", "-T", "db", "sh", "-c", "pg_dump -U financas -d financas > /tmp/copia.sql") | Out-Null
  Rodar "docker" @("compose", "cp", "db:/tmp/copia.sql", (Join-Path $PastaBackups $nome)) | Out-Null
  Rodar "docker" @("compose", "exec", "-T", "db", "rm", "-f", "/tmp/copia.sql") | Out-Null
  Get-ChildItem -LiteralPath $PastaBackups -Filter "financas-*.sql" | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Force
  return $nome
}

function Atualizar {
  Gravar-Estado "ATUALIZANDO" "Guardando uma copia do banco de dados..."
  $copia = Copiar-Banco
  Gravar-Estado "ATUALIZANDO" "Baixando a versao nova do GitHub..."
  $ramo = (Rodar "git" @("rev-parse", "--abbrev-ref", "HEAD")).Trim()
  $antes = (Rodar "git" @("rev-parse", "HEAD")).Trim()
  # --ff-only: so avanca. Se houver alteracao local que conflite, para sem apagar nada.
  Rodar "git" @("pull", "--ff-only", "origin", $ramo) | Out-Null
  $depois = (Rodar "git" @("rev-parse", "HEAD")).Trim()
  Gravar-Estado "ATUALIZANDO" "Reconstruindo o sistema (pode levar alguns minutos)..."
  Rodar "docker" @("compose", "up", "-d", "--build") | Out-Null
  Gravar-Versao
  if ($antes -eq $depois) {
    Gravar-Estado "OK" "O sistema ja estava na ultima versao. Copia do banco: $copia"
  } else {
    Gravar-Estado "OK" "Atualizado de $($antes.Substring(0,7)) para $($depois.Substring(0,7)). Copia do banco: $copia"
  }
}

function Atualizar-ComRegistro {
  try {
    Atualizar
    return $true
  } catch {
    $mensagem = "$($_.Exception.Message)"
    if ($mensagem.Length -gt 400) { $mensagem = $mensagem.Substring(0, 400) }
    Gravar-Estado "ERRO" $mensagem
    return $false
  }
}

if ($Desinstalar) {
  if (Get-ScheduledTask -TaskName $NomeDaTarefa -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $NomeDaTarefa -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $NomeDaTarefa -Confirm:$false
    Write-Host "Tarefa removida. O botao da tela volta a so avisar que ha versao nova."
  } else {
    Write-Host "A tarefa nao estava instalada."
  }
  exit 0
}

if ($Instalar) {
  Gravar-Versao
  $acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Vigiar" -WorkingDirectory $Raiz
  $gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $NomeDaTarefa -Action $acao -Trigger $gatilho -Settings $ajustes -Description "Espera o pedido do botao Atualizar do sistema Financas Pessoais e atualiza pelo GitHub." -Force | Out-Null
  Start-ScheduledTask -TaskName $NomeDaTarefa
  Write-Host "Pronto. O botao Atualizar da tela ja funciona neste computador."
  Write-Host "A tarefa '$NomeDaTarefa' inicia sozinha quando voce entra no Windows."
  Write-Host "Para remover: powershell -ExecutionPolicy Bypass -File atualizar.ps1 -Desinstalar"
  exit 0
}

if ($Vigiar) {
  try { Gravar-Versao } catch { }
  if (-not (Test-Path -LiteralPath $ArquivoEstado)) { Gravar-Estado "PARADO" "" }
  while ($true) {
    try {
      if (Test-Path -LiteralPath $ArquivoPedido) {
        Remove-Item -LiteralPath $ArquivoPedido -Force
        Atualizar-ComRegistro | Out-Null
      } else {
        # Batimento: a tela sabe que o vigia esta vivo.
        $estado = @{ situacao = "PARADO"; mensagem = ""; em = (Agora) }
        if (Test-Path -LiteralPath $ArquivoEstado) {
          try { $lido = Get-Content -LiteralPath $ArquivoEstado -Raw -Encoding utf8 | ConvertFrom-Json; $estado = @{ situacao = $lido.situacao; mensagem = $lido.mensagem; em = $lido.em } } catch { }
        }
        # Uma atualizacao interrompida (computador desligado no meio) nao fica "atualizando" para sempre.
        if ($estado.situacao -eq "ATUALIZANDO") { $estado.situacao = "ERRO"; $estado.mensagem = "A atualizacao foi interrompida. Tente de novo." }
        $estado.vigiaVistoEm = (Agora)
        Gravar-Json $ArquivoEstado $estado
      }
    } catch { }
    Start-Sleep -Seconds 5
  }
}

# Sem parametros: atualiza agora.
Write-Host "Atualizando o sistema..."
if (Atualizar-ComRegistro) {
  Write-Host ((Get-Content -LiteralPath $ArquivoEstado -Raw -Encoding utf8 | ConvertFrom-Json).mensagem)
  exit 0
} else {
  Write-Host "Nao foi possivel atualizar:"
  Write-Host ((Get-Content -LiteralPath $ArquivoEstado -Raw -Encoding utf8 | ConvertFrom-Json).mensagem)
  exit 1
}
