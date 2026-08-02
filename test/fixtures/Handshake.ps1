param(
    [switch]$InstallRuntime,
    [switch]$InstallFramework,
    [int]$WaitForPid = 0,
    [switch]$Bootstrap
)

$ErrorActionPreference = 'Stop'
$statusPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'update-status.json'

if ($Bootstrap) {
    $quotedScript = '"' + $PSCommandPath + '"'
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $quotedScript, '-InstallRuntime', '-WaitForPid', [string]$WaitForPid)
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    exit 0
}

function Save-TestStatus([string]$State, [string]$Message) {
    $temporary = $statusPath + ".$PID.new"
    [ordered]@{
        state = $State
        scope = 'runtime'
        message = $Message
        processId = $PID
        timestamp = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force
}

Save-TestStatus 'checking' 'Integration helper started.'
Start-Sleep -Milliseconds 750
Save-TestStatus 'completed' 'Integration helper completed.'
