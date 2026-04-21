param(
    [string]$ChromePath = '',
    [string]$UserDataDir = '',
    [int]$StartupTimeoutSeconds = 45,
    [string]$McpPackage = 'chrome-devtools-mcp@latest',
    [switch]$NoMcp,
    [switch]$PrintBrowserInfo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$mutexName = 'Global\FullAccessMcpChromeDevtoolsSingleton'

function Resolve-ChromeExecutable {
    param([string]$ConfiguredPath)

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        if (-not (Test-Path -LiteralPath $ConfiguredPath)) {
            throw "Configured Chrome executable not found: $ConfiguredPath"
        }

        return $ConfiguredPath
    }

    $commandCandidate = Get-Command 'chrome.exe' -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $commandCandidate -and $commandCandidate.Source) {
        return $commandCandidate.Source
    }

    $pathCandidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $pathCandidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw 'Unable to locate chrome.exe. Set CHROME_EXECUTABLE in .env.'
}

if ([string]::IsNullOrWhiteSpace($ChromePath)) {
    $ChromePath = $env:CHROME_EXECUTABLE
}

if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
    $UserDataDir = $env:CHROME_DEVTOOLS_USER_DATA_DIR
}

if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
    $UserDataDir = Join-Path $env:LOCALAPPDATA 'full-access-mcp\chrome-devtools-mcp-profile'
}

$ChromePath = Resolve-ChromeExecutable -ConfiguredPath $ChromePath
$devToolsActivePortPath = Join-Path $UserDataDir 'DevToolsActivePort'
$encodedUserDataDir = [Regex]::Escape($UserDataDir)

function Read-DevToolsPort {
    if (-not (Test-Path -LiteralPath $devToolsActivePortPath)) {
        return $null
    }

    try {
        $lines = Get-Content -LiteralPath $devToolsActivePortPath -ErrorAction Stop
    }
    catch {
        return $null
    }

    if (-not $lines -or $lines.Count -lt 1) {
        return $null
    }

    $portLine = ([string]$lines[0]).Trim()
    if ($portLine -match '^\d+$') {
        return [int]$portLine
    }

    return $null
}

function Test-BrowserEndpoint {
    param(
        [int]$Port
    )

    if ($Port -le 0) {
        return $null
    }

    $browserUrl = "http://127.0.0.1:$Port"
    $versionUrl = "$browserUrl/json/version"

    try {
        $version = Invoke-RestMethod -Uri $versionUrl -Method Get -TimeoutSec 2
    }
    catch {
        return $null
    }

    if (-not $version.webSocketDebuggerUrl) {
        return $null
    }

    return [pscustomobject]@{
        browserUrl = $browserUrl
        port = $Port
        version = $version
    }
}

function Get-ManagedChromeRoots {
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match $encodedUserDataDir -and
        $_.CommandLine -notmatch '--type='
    }
}

function Wait-ForBrowserEndpoint {
    param(
        [datetime]$Deadline
    )

    while ((Get-Date) -lt $Deadline) {
        $port = Read-DevToolsPort
        if ($null -ne $port) {
            $browserInfo = Test-BrowserEndpoint -Port $port
            if ($null -ne $browserInfo) {
                return $browserInfo
            }
        }

        Start-Sleep -Milliseconds 300
    }

    return $null
}

function Stop-StaleManagedChrome {
    $roots = @(Get-ManagedChromeRoots)
    foreach ($root in $roots) {
        Stop-Process -Id $root.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-NpxCommand {
    $npxCommand = Get-Command 'npx.cmd' -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $npxCommand -and $npxCommand.Source) {
        return $npxCommand.Source
    }

    $nodeCommand = Get-Command 'node.exe' -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $nodeCommand -and $nodeCommand.Source) {
        $candidate = Join-Path (Split-Path -Parent $nodeCommand.Source) 'npx.cmd'
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw 'Unable to locate npx.cmd for chrome-devtools-mcp startup.'
}

New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$lockAcquired = $false

try {
    $lockAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds($StartupTimeoutSeconds))
    if (-not $lockAcquired) {
        throw 'Timed out acquiring browser singleton lock.'
    }

    $browserInfo = Wait-ForBrowserEndpoint -Deadline (Get-Date).AddSeconds(3)

    if ($null -eq $browserInfo) {
        $roots = @(Get-ManagedChromeRoots)
        if ($roots.Count -gt 0) {
            Stop-StaleManagedChrome
            Start-Sleep -Seconds 1
            Remove-Item -LiteralPath $devToolsActivePortPath -Force -ErrorAction SilentlyContinue
        }

        $browserArguments = @(
            '--remote-debugging-port=0',
            '--remote-debugging-address=127.0.0.1',
            "--user-data-dir=$UserDataDir",
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-session-crashed-bubble',
            'about:blank'
        )

        Start-Process -FilePath $ChromePath -ArgumentList $browserArguments | Out-Null
        $browserInfo = Wait-ForBrowserEndpoint -Deadline (Get-Date).AddSeconds($StartupTimeoutSeconds)
    }

    if ($null -eq $browserInfo) {
        throw 'Failed to start or locate the dedicated Chrome DevTools instance.'
    }
}
finally {
    if ($lockAcquired) {
        [void]$mutex.ReleaseMutex()
    }

    $mutex.Dispose()
}

$managedChromeRoots = @(Get-ManagedChromeRoots)
$browserReport = [pscustomobject]@{
    browserUrl = $browserInfo.browserUrl
    port = $browserInfo.port
    webSocketDebuggerUrl = $browserInfo.version.webSocketDebuggerUrl
    browser = $browserInfo.version.Browser
    userDataDir = $UserDataDir
    chromePath = $ChromePath
    managedRootProcessIds = @($managedChromeRoots | Select-Object -ExpandProperty ProcessId)
}

if ($PrintBrowserInfo -or $NoMcp) {
    $browserReport | ConvertTo-Json -Depth 5
}

if ($NoMcp) {
    exit 0
}

$env:CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1'
$npxCommand = Resolve-NpxCommand
& $npxCommand -y $McpPackage --browserUrl $browserInfo.browserUrl --no-usage-statistics

if ($null -eq (Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue)) {
    exit 0
}

exit ([int]$LASTEXITCODE)
