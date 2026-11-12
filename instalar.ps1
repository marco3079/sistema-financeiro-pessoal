# Instalador do Sistema Financeiro Pessoal para Windows (PowerShell 5.1 ou mais novo).
# Uso: powershell -ExecutionPolicy Bypass -File .\instalar.ps1 [-PortaWeb 8092] [-PortaApi 3092] [-SemPerguntas]
# Codigos de saida: 0 = ok; 2 = Docker nao instalado; 3 = Docker parado ou sem Compose;
#                   4 = falha ao subir os conteineres; 5 = API nao respondeu;
#                   6 = existe o banco de uma instalacao anterior, mas nao ha .env com a senha dele.

param(
    [int]$PortaWeb = 8092,
    [int]$PortaApi = 3092,
    [switch]$SemPerguntas
)

$ErrorActionPreference = 'Stop'

function Executar-Comando {
    # Roda um programa externo sem que o stderr dele pare o script. Devolve o codigo de saida.
    param(
        [string]$Programa,
        [string[]]$Argumentos,
        [switch]$Silencioso
    )
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($Silencioso) {
            & $Programa @Argumentos *> $null
        } else {
            & $Programa @Argumentos | Out-Host
        }
        return $LASTEXITCODE
    } catch {
        return 1
    } finally {
        $ErrorActionPreference = $anterior
    }
}

function Perguntar-Sim {
    param([string]$Pergunta)
    if ($SemPerguntas) { return $true }
    $resposta = Read-Host ($Pergunta + ' [S/n]')
    return ($resposta -eq '' -or $resposta -match '^[sSyY]')
}

function Gerar-Segredo {
    # Letras e numeros com RandomNumberGenerator, sem vies (descarta bytes acima do limite).
    param([int]$Tamanho)
    $alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $limite = 256 - (256 % $alfabeto.Length)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $sb = New-Object System.Text.StringBuilder
    $um = New-Object byte[] 1
    try {
        while ($sb.Length -lt $Tamanho) {
            $rng.GetBytes($um)
            if ($um[0] -lt $limite) {
                [void]$sb.Append($alfabeto[$um[0] % $alfabeto.Length])
            }
        }
    } finally {
        $rng.Dispose()
    }
    return $sb.ToString()
}

function Ler-Variavel {
    param([string]$Arquivo, [string]$Nome)
    foreach ($linha in [System.IO.File]::ReadAllLines($Arquivo)) {
        if ($linha -match ('^\s*' + $Nome + '\s*=\s*(.*?)\s*$')) {
            return $matches[1]
        }
    }
    return ''
}

function Porta-Ocupada {
    param([int]$Porta)
    try {
        $escutando = Get-NetTCPConnection -State Listen -LocalPort $Porta -ErrorAction SilentlyContinue
        return ($null -ne $escutando)
    } catch {
        return $false
    }
}

function Escolher-Porta {
    param([int]$Inicial, [int]$Evitar)
    $porta = $Inicial
    for ($tentativa = 1; $tentativa -le 20; $tentativa++) {
        if (($porta -ne $Evitar) -and (-not (Porta-Ocupada $porta))) {
            if ($porta -ne $Inicial) {
                Write-Host "Porta $Inicial em uso. Usando a porta $porta."
            }
            return $porta
        }
        $porta = $porta + 1
    }
    throw "Nenhuma porta livre encontrada a partir de $Inicial."
}

function Obter-IP {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|WSL' } |
            Select-Object -First 1
        if ($null -ne $ip) { return $ip.IPAddress }
    } catch {
        # sem IP detectado: usa o texto generico abaixo
    }
    return '<IP do computador>'
}

function Obter-NomeProjeto {
    # Nome do projeto Compose (campo "name" de docker compose config); se nao der, deriva da pasta.
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $texto = (& docker compose config --format json 2>$null) | Out-String
        if ($LASTEXITCODE -eq 0) {
            $dados = $texto | ConvertFrom-Json
            if ($dados.name) { return [string]$dados.name }
        }
    } catch {
        # cai no nome derivado da pasta
    } finally {
        $ErrorActionPreference = $anterior
    }
    $pasta = (Split-Path -Leaf $PSScriptRoot).ToLower()
    return ($pasta -replace '[^a-z0-9_-]', '')
}

function Existe-Volume {
    # Confere o nome exato do volume (o filtro do docker faz busca parcial).
    param([string]$Nome)
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lista = (& docker volume ls -q --filter ('name=' + $Nome) 2>$null)
        foreach ($volume in $lista) {
            if ($volume.Trim() -eq $Nome) { return $true }
        }
        return $false
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $anterior
    }
}

# [1/6] Pasta do script
Write-Host '[1/6] Indo para a pasta do projeto...'
Set-Location -LiteralPath $PSScriptRoot
$arquivoEnv = Join-Path $PSScriptRoot '.env'
$envExiste = Test-Path -LiteralPath $arquivoEnv
$envCriadoAgora = $false
$senhaAdmin = ''
$adminEmail = 'demo@financas.local'
$adminSenhaExistente = ''

# [2/6] Docker instalado
Write-Host '[2/6] Verificando o Docker...'
$temDocker = (Executar-Comando -Programa 'docker' -Argumentos @('--version') -Silencioso) -eq 0
if (-not $temDocker) {
    Write-Host 'O Docker Desktop e necessario para rodar o sistema, e ele nao foi encontrado.'
    $temWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
    if ($temWinget) {
        if (Perguntar-Sim 'Instalar o Docker Desktop agora pelo winget?') {
            $codigoWinget = Executar-Comando -Programa 'winget' -Argumentos @('install', '-e', '--id', 'Docker.DockerDesktop', '--accept-source-agreements', '--accept-package-agreements')
            if ($codigoWinget -ne 0) {
                Write-Host ('O winget nao conseguiu instalar o Docker Desktop (codigo ' + $codigoWinget + ').')
            }
        }
    }
    Write-Host 'Depois de instalar: abra o Docker Desktop, espere ele iniciar e rode este script de novo.'
    Write-Host 'Guia oficial: https://www.docker.com/products/docker-desktop/'
    exit 2
}

# [3/6] Docker rodando e com Compose
Write-Host '[3/6] Verificando se o Docker esta rodando...'
if ((Executar-Comando -Programa 'docker' -Argumentos @('info') -Silencioso) -ne 0) {
    Write-Host 'O Docker esta instalado, mas nao esta rodando.'
    Write-Host 'Abra o Docker Desktop, espere ele iniciar e rode este script de novo.'
    exit 3
}
if ((Executar-Comando -Programa 'docker' -Argumentos @('compose', 'version') -Silencioso) -ne 0) {
    Write-Host 'Docker Compose nao encontrado. Atualize o Docker Desktop e rode este script de novo.'
    exit 3
}

# [4/6] Portas
Write-Host '[4/6] Verificando as portas...'
if ($envExiste) {
    $lidaWeb = Ler-Variavel $arquivoEnv 'WEB_PORT'
    $lidaApi = Ler-Variavel $arquivoEnv 'API_PORT'
    $portaWeb = 8092
    $portaApi = 3092
    if ($lidaWeb -match '^\d+$') { $portaWeb = [int]$lidaWeb }
    if ($lidaApi -match '^\d+$') { $portaApi = [int]$lidaApi }
    Write-Host 'Usando as portas do .env existente.'
    if (Porta-Ocupada $portaWeb) {
        Write-Host "Aviso: a porta $portaWeb ja esta em uso (se for o proprio sistema rodando, pode ignorar)."
    }
    if (Porta-Ocupada $portaApi) {
        Write-Host "Aviso: a porta $portaApi ja esta em uso (se for o proprio sistema rodando, pode ignorar)."
    }
} else {
    $portaWeb = Escolher-Porta -Inicial $PortaWeb -Evitar 0
    $portaApi = Escolher-Porta -Inicial $PortaApi -Evitar $portaWeb
}

# [5/6] Arquivo .env
Write-Host '[5/6] Preparando o arquivo .env...'
if ($envExiste) {
    Write-Host 'Usando o .env existente.'
    $adminEmailLido = Ler-Variavel $arquivoEnv 'ADMIN_EMAIL'
    if ($adminEmailLido -ne '') { $adminEmail = $adminEmailLido }
    $adminSenhaExistente = Ler-Variavel $arquivoEnv 'ADMIN_SENHA'
} else {
    # Um banco de uma instalacao anterior nao aceita senha nova: para antes de criar o .env.
    $volumeBanco = (Obter-NomeProjeto) + '_dados_db'
    if (Existe-Volume $volumeBanco) {
        Write-Host ('Ja existe um banco de dados desta instalacao (volume ' + $volumeBanco + '), mas nao ha arquivo .env com a senha dele.')
        Write-Host 'Saidas possiveis:'
        Write-Host '  (a) Recoloque o arquivo .env antigo nesta pasta e rode este script de novo.'
        Write-Host '  (b) Se o banco antigo puder ser apagado (isso apaga todos os dados), rode: docker compose down -v'
        Write-Host '      e depois rode este script de novo.'
        Write-Host 'Nada foi apagado e o .env nao foi criado.'
        exit 6
    }
    $senhaBanco = Gerar-Segredo -Tamanho 24
    $segredoJwt = Gerar-Segredo -Tamanho 48
    $senhaAdmin = 'demo1234'
    $linhas = @(
        '# Gerado pelo instalar.ps1. Nao envie este arquivo para o Git.',
        ('POSTGRES_PASSWORD=' + $senhaBanco),
        ('JWT_SECRET=' + $segredoJwt),
        'ADMIN_NOME=Demo',
        ('ADMIN_EMAIL=' + $adminEmail),
        ('ADMIN_SENHA=' + $senhaAdmin),
        ('WEB_PORT=' + $portaWeb),
        ('API_PORT=' + $portaApi),
        'DB_PORT=5433'
    )
    $conteudo = [string]::Join("`n", $linhas) + "`n"
    [System.IO.File]::WriteAllText($arquivoEnv, $conteudo, (New-Object System.Text.UTF8Encoding($false)))
    $envCriadoAgora = $true
    Write-Host 'Arquivo .env criado com segredos aleatorios.'
}

# [6/6] Subir os conteineres e esperar a API
Write-Host '[6/6] Subindo os conteineres (na primeira vez o Docker baixa as dependencias, pode demorar)...'
$codigoUp = Executar-Comando -Programa 'docker' -Argumentos @('compose', 'up', '-d', '--build')
if ($codigoUp -ne 0) {
    Write-Host 'Falha ao subir os conteineres. Ultimas linhas do log:'
    [void](Executar-Comando -Programa 'docker' -Argumentos @('compose', 'logs', '--tail', '40'))
    exit 4
}

$urlSaude = 'http://localhost:' + $portaApi + '/api/saude'
Write-Host ('Aguardando a API responder em ' + $urlSaude + ' (ate 180 segundos)...')
$prontoApi = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resposta = Invoke-WebRequest -UseBasicParsing -Uri $urlSaude -TimeoutSec 5
        if ($resposta.StatusCode -eq 200) {
            $prontoApi = $true
            break
        }
    } catch {
        # ainda subindo
    }
    Start-Sleep -Seconds 3
}
if (-not $prontoApi) {
    Write-Host 'A API nao respondeu a tempo. Ultimas linhas do log da API:'
    [void](Executar-Comando -Programa 'docker' -Argumentos @('compose', 'logs', '--tail', '40', 'api'))
    exit 5
}

# Quadro final
if ($envCriadoAgora -or $adminSenhaExistente -eq '' -or $adminSenhaExistente -eq 'demo1234') {
    $linhaSenha = 'Senha:          demo1234 (padrao; troque em "Meu perfil")'
} else {
    $linhaSenha = 'Senha:          a senha esta no arquivo .env, variavel ADMIN_SENHA'
}
$ipComputador = Obter-IP

Write-Host ''
Write-Host '============================================================'
Write-Host ' Sistema financeiro pessoal instalado e no ar'
Write-Host '============================================================'
Write-Host ('Site:           http://localhost:' + $portaWeb)
Write-Host ('Titular:        ' + $adminEmail)
Write-Host $linhaSenha
Write-Host 'Troque a senha em "Meu perfil" depois do primeiro acesso.'
Write-Host ''
Write-Host ('No celular (mesma rede Wi-Fi): http://' + $ipComputador + ':' + $portaWeb)
Write-Host ''
Write-Host 'Parar o sistema:           docker compose down'
Write-Host 'Apagar tudo (inclui banco): docker compose down -v'
Write-Host '============================================================'
exit 0
