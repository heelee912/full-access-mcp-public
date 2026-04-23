param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimeDir = Join-Path $script:RepoRoot '.runtime'
$script:StatePath = Join-Path $script:RuntimeDir 'runtime-stack.json'

function Ensure-RuntimeDirectory {
    New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
}

function Read-DotEnvFile {
    $dotEnvPath = Join-Path $script:RepoRoot '.env'
    if (-not (Test-Path -LiteralPath $dotEnvPath)) {
        return @{}
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $dotEnvPath -ErrorAction Stop) {
        $trimmedLine = $line.Trim()
        if ($trimmedLine -eq '' -or $trimmedLine.StartsWith('#')) {
            continue
        }

        $separatorIndex = $trimmedLine.IndexOf('=')
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $trimmedLine.Substring(0, $separatorIndex).Trim()
        $value = $trimmedLine.Substring($separatorIndex + 1).Trim()
        if (-not [string]::IsNullOrWhiteSpace($key)) {
            $values[$key] = $value
        }
    }

    return $values
}

function Get-SettingValue {
    param(
        [hashtable]$DotEnv,
        [string]$Key,
        [string]$Fallback = ''
    )

    $processValue = [Environment]::GetEnvironmentVariable($Key)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue
    }

    if ($DotEnv.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$DotEnv[$Key])) {
        return [string]$DotEnv[$Key]
    }

    return $Fallback
}

function Parse-BooleanSetting {
    param(
        [string]$Value,
        [bool]$Fallback
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Fallback
    }

    switch ($Value.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'on' { return $true }
        '0' { return $false }
        'false' { return $false }
        'no' { return $false }
        'off' { return $false }
        default { return $Fallback }
    }
}

function Get-ExistingProcess {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return $null
    }

    try {
        return Get-Process -Id $ProcessId -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function Stop-ProcessIfRunning {
    param([int]$ProcessId)

    $process = Get-ExistingProcess -ProcessId $ProcessId
    if ($null -eq $process) {
        return $false
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    return $true
}

function Read-State {
    if (-not (Test-Path -LiteralPath $script:StatePath)) {
        return $null
    }

    return Get-Content -LiteralPath $script:StatePath -Raw -ErrorAction Stop | ConvertFrom-Json
}

function Write-State {
    param([hashtable]$State)

    Ensure-RuntimeDirectory
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:StatePath -Encoding UTF8
}

function Remove-State {
    if (Test-Path -LiteralPath $script:StatePath) {
        Remove-Item -LiteralPath $script:StatePath -Force -ErrorAction SilentlyContinue
    }
}

function Get-PublicGatewayDomain {
    param([hashtable]$DotEnv)

    $publicBaseUrl = Get-SettingValue -DotEnv $DotEnv -Key 'PUBLIC_GATEWAY_BASE_URL'
    if ([string]::IsNullOrWhiteSpace($publicBaseUrl)) {
        return ''
    }

    return ([Uri]$publicBaseUrl).Host
}

function Resolve-NgrokExecutable {
    param([hashtable]$DotEnv)

    $configuredPath = Get-SettingValue -DotEnv $DotEnv -Key 'NGROK_EXECUTABLE'
    if (-not [string]::IsNullOrWhiteSpace($configuredPath)) {
        if (-not (Test-Path -LiteralPath $configuredPath)) {
            throw "Configured NGROK_EXECUTABLE was not found: $configuredPath"
        }

        return $configuredPath
    }

    $command = Get-Command 'ngrok.exe' -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $command -and $command.Source) {
        return $command.Source
    }

    $wingetCandidate = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe'
    if (Test-Path -LiteralPath $wingetCandidate) {
        return $wingetCandidate
    }

    throw 'Unable to locate ngrok.exe. Set NGROK_EXECUTABLE in .env.'
}

function Start-HiddenProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [hashtable]$EnvironmentVariables = @{}
    )

    Ensure-RuntimeDirectory

    $previousValues = @{}

    try {
        foreach ($entry in $EnvironmentVariables.GetEnumerator()) {
            $key = [string]$entry.Key
            $previousValues[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, [string]$entry.Value, 'Process')
        }

        return Start-Process `
            -FilePath $FilePath `
            -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden `
            -RedirectStandardOutput $StdOutPath `
            -RedirectStandardError $StdErrPath `
            -PassThru
    }
    finally {
        foreach ($entry in $previousValues.GetEnumerator()) {
            $key = [string]$entry.Key
            $value = [string]$entry.Value
            if ([string]::IsNullOrEmpty($value)) {
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
                continue
            }

            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Invoke-HealthCheck {
    param([int]$Port)

    try {
        $content = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
        return ($content.Content | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Wait-ForGatewayStartupLog {
    param(
        [string]$LogPath,
        [int]$GatewayProcessId,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -eq (Get-ExistingProcess -ProcessId $GatewayProcessId)) {
            throw "Gateway process exited before startup completed. See $LogPath"
        }

        if (Test-Path -LiteralPath $LogPath) {
            $logContent = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
            if ($logContent -match 'remote MCP gateway listening on ') {
                return
            }
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Gateway startup log did not appear within $TimeoutSeconds seconds. See $LogPath"
}

function Get-ProcessState {
    param(
        [string]$Name,
        [pscustomobject]$ProcessRecord
    )

    $process = Get-ExistingProcess -ProcessId ([int]$ProcessRecord.pid)

    [pscustomobject]@{
        name = $Name
        pid = [int]$ProcessRecord.pid
        running = ($null -ne $process)
        startedAt = $ProcessRecord.startedAt
        stdout = $ProcessRecord.stdout
        stderr = $ProcessRecord.stderr
    }
}

function Show-Status {
    $state = Read-State
    if ($null -eq $state) {
        [pscustomobject]@{
            running = $false
            reason = 'runtime stack is not started'
        } | ConvertTo-Json -Depth 6
        return
    }

    $health = $null
    if ($state.gateway -and $state.gateway.port) {
        $health = Invoke-HealthCheck -Port ([int]$state.gateway.port)
    }

    $ngrokRecord = $null
    if ($state.PSObject.Properties.Name -contains 'ngrok') {
        $ngrokRecord = $state.ngrok
    }

    [pscustomobject]@{
        running = $true
        startedAt = $state.startedAt
        gateway = Get-ProcessState -Name 'gateway' -ProcessRecord $state.gateway
        agent = Get-ProcessState -Name 'agent' -ProcessRecord $state.agent
        ngrok = if ($ngrokRecord) { Get-ProcessState -Name 'ngrok' -ProcessRecord $ngrokRecord } else { $null }
        health = $health
    } | ConvertTo-Json -Depth 8
}

function Stop-RuntimeStack {
    $state = Read-State
    if ($null -eq $state) {
        return
    }

    if ($state.PSObject.Properties.Name -contains 'ngrok' -and $state.ngrok) {
        [void](Stop-ProcessIfRunning -ProcessId ([int]$state.ngrok.pid))
    }

    if ($state.agent) {
        [void](Stop-ProcessIfRunning -ProcessId ([int]$state.agent.pid))
    }

    if ($state.gateway) {
        [void](Stop-ProcessIfRunning -ProcessId ([int]$state.gateway.pid))
    }

    Remove-State
}

function Start-RuntimeStack {
    $existingState = Read-State
    if ($null -ne $existingState) {
        $gatewayRunning = $existingState.gateway -and (Get-ExistingProcess -ProcessId ([int]$existingState.gateway.pid))
        $agentRunning = $existingState.agent -and (Get-ExistingProcess -ProcessId ([int]$existingState.agent.pid))
        if ($gatewayRunning -or $agentRunning) {
            Show-Status
            return
        }

        Remove-State
    }

    $dotEnv = Read-DotEnvFile
    $gatewayPort = [int](Get-SettingValue -DotEnv $dotEnv -Key 'GATEWAY_PORT' -Fallback '9797')
    $ngrokAutostart = Parse-BooleanSetting -Value (Get-SettingValue -DotEnv $dotEnv -Key 'NGROK_AUTOSTART' -Fallback 'false') -Fallback:$false

    $gatewayProcess = $null
    $agentProcess = $null
    $ngrokProcess = $null

    try {
        $gatewayStdOutPath = Join-Path $script:RuntimeDir 'gateway.out.log'
        $gatewayStdErrPath = Join-Path $script:RuntimeDir 'gateway.err.log'
        $agentStdOutPath = Join-Path $script:RuntimeDir 'agent.out.log'
        $agentStdErrPath = Join-Path $script:RuntimeDir 'agent.err.log'

        $gatewayProcess = Start-HiddenProcess `
            -FilePath 'node.exe' `
            -ArgumentList @('dist/src/gatewayIndex.js') `
            -WorkingDirectory $script:RepoRoot `
            -StdOutPath $gatewayStdOutPath `
            -StdErrPath $gatewayStdErrPath `
            -EnvironmentVariables $dotEnv

        Wait-ForGatewayStartupLog -LogPath $gatewayStdOutPath -GatewayProcessId $gatewayProcess.Id

        $agentProcess = Start-HiddenProcess `
            -FilePath 'node.exe' `
            -ArgumentList @('dist/src/agentIndex.js') `
            -WorkingDirectory $script:RepoRoot `
            -StdOutPath $agentStdOutPath `
            -StdErrPath $agentStdErrPath `
            -EnvironmentVariables $dotEnv

        $state = @{
            startedAt = (Get-Date).ToString('o')
            gateway = @{
                pid = $gatewayProcess.Id
                port = $gatewayPort
                stdout = $gatewayStdOutPath
                stderr = $gatewayStdErrPath
                startedAt = (Get-Date).ToString('o')
            }
            agent = @{
                pid = $agentProcess.Id
                stdout = $agentStdOutPath
                stderr = $agentStdErrPath
                startedAt = (Get-Date).ToString('o')
            }
        }

        if ($ngrokAutostart) {
            $ngrokExecutable = Resolve-NgrokExecutable -DotEnv $dotEnv
            $ngrokDomain = Get-SettingValue -DotEnv $dotEnv -Key 'NGROK_URL'
            if ([string]::IsNullOrWhiteSpace($ngrokDomain)) {
                $ngrokDomain = Get-SettingValue -DotEnv $dotEnv -Key 'NGROK_DOMAIN' -Fallback (Get-PublicGatewayDomain -DotEnv $dotEnv)
            }

            if ([string]::IsNullOrWhiteSpace($ngrokDomain)) {
                throw 'NGROK_AUTOSTART=true but NGROK_DOMAIN or PUBLIC_GATEWAY_BASE_URL is not configured.'
            }

            $ngrokProcess = Start-HiddenProcess `
                -FilePath $ngrokExecutable `
                -ArgumentList @('http', [string]$gatewayPort, "--url=$ngrokDomain") `
                -WorkingDirectory $script:RepoRoot `
                -StdOutPath (Join-Path $script:RuntimeDir 'ngrok.out.log') `
                -StdErrPath (Join-Path $script:RuntimeDir 'ngrok.err.log') `
                -EnvironmentVariables $dotEnv

            $state.ngrok = @{
                pid = $ngrokProcess.Id
                domain = $ngrokDomain
                executable = $ngrokExecutable
                stdout = (Join-Path $script:RuntimeDir 'ngrok.out.log')
                stderr = (Join-Path $script:RuntimeDir 'ngrok.err.log')
                startedAt = (Get-Date).ToString('o')
            }
        }

        Write-State -State $state
        Show-Status
    } catch {
        if ($ngrokProcess) {
            [void](Stop-ProcessIfRunning -ProcessId $ngrokProcess.Id)
        }
        if ($agentProcess) {
            [void](Stop-ProcessIfRunning -ProcessId $agentProcess.Id)
        }
        if ($gatewayProcess) {
            [void](Stop-ProcessIfRunning -ProcessId $gatewayProcess.Id)
        }
        Remove-State
        throw
    }
}

switch ($Action) {
    'start' {
        Start-RuntimeStack
        break
    }
    'stop' {
        Stop-RuntimeStack
        Show-Status
        break
    }
    'restart' {
        Stop-RuntimeStack
        Start-RuntimeStack
        break
    }
    'status' {
        Show-Status
        break
    }
}
