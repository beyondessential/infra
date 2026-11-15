<#
.SYNOPSIS
    Installs SelfShutdown.ps1 as a Windows service on THIS server that starts on every boot.

.DESCRIPTION
    Run from an elevated (Administrator) PowerShell prompt on the clone server, with
    SelfShutdown.ps1 in the same folder as this script.

    What it does:
      1. Copies SelfShutdown.ps1 to C:\CloneCleanup
      2. Downloads NSSM (service wrapper) into that folder if it isn't there
      3. Registers service "CloneSelfShutdown", Startup type Automatic, restarts on failure
      4. Starts the service, which starts the 7-day clock

    To remove:  .\Install-SelfShutdown.ps1 -Uninstall
    To change the cutoff later, re-run with a different -MaxAgeDays (the clock is kept).

.EXAMPLE
    .\Install-SelfShutdown.ps1
    .\Install-SelfShutdown.ps1 -MaxAgeDays 3
    .\Install-SelfShutdown.ps1 -SlackWebhookUrl https://hooks.slack.com/services/XXXX/YYYY/ZZZZ
#>
[CmdletBinding()]
param(
    [string] $InstallDir      = 'C:\CloneCleanup',
    [string] $ServiceName     = 'CloneSelfShutdown',
    [int]    $MaxAgeDays      = 7,
    [string] $SlackWebhookUrl = '',      # optional: Slack incoming webhook URL
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) {
    throw 'Run this from an elevated (Administrator) PowerShell prompt.'
}

$nssm = Join-Path $InstallDir 'nssm.exe'

if ($Uninstall) {
    if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
        & $nssm stop   $ServiceName | Out-Null
        & $nssm remove $ServiceName confirm | Out-Null
        Write-Host "Service $ServiceName removed. Files left in $InstallDir."
    } else {
        Write-Host "Service $ServiceName not found."
    }
    return
}

# 1. Copy the script
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'SelfShutdown.ps1') -Destination $InstallDir -Force

# 2. Get NSSM
if (-not (Test-Path $nssm)) {
    Write-Host 'Downloading NSSM...'
    $zip = Join-Path $env:TEMP 'nssm.zip'
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip
    $tmp = Join-Path $env:TEMP 'nssm-extract'
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
    Copy-Item (Get-ChildItem -Path $tmp -Recurse -Filter nssm.exe | Where-Object FullName -like "*$arch*" | Select-Object -First 1).FullName $nssm
    Remove-Item $zip, $tmp -Recurse -Force
}

# 3. Register the service (replace if it already exists, keeping the clock file)
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
    & $nssm stop   $ServiceName | Out-Null
    & $nssm remove $ServiceName confirm | Out-Null
}

$psExe  = Join-Path $PSHOME 'powershell.exe'
$script = Join-Path $InstallDir 'SelfShutdown.ps1'
$args   = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -MaxAgeDays $MaxAgeDays"
if ($SlackWebhookUrl) { $args += " -SlackWebhookUrl `"$SlackWebhookUrl`"" }

& $nssm install $ServiceName $psExe $args
& $nssm set $ServiceName AppDirectory   $InstallDir
& $nssm set $ServiceName DisplayName    'Tamanu Clone Self-Shutdown'
& $nssm set $ServiceName Description    "Shuts this server down after $MaxAgeDays days. Create $InstallDir\KeepUntil.txt with a date to hold it."
& $nssm set $ServiceName Start          SERVICE_AUTO_START
& $nssm set $ServiceName AppExit        Default Restart
& $nssm set $ServiceName AppRestartDelay 60000
& $nssm set $ServiceName AppStdout      (Join-Path $InstallDir 'service-stdout.log')
& $nssm set $ServiceName AppStderr      (Join-Path $InstallDir 'service-stderr.log')
& $nssm set $ServiceName AppRotateFiles 1

# 4. Start it
& $nssm start $ServiceName
Start-Sleep 3
Get-Service $ServiceName | Format-Table Name, Status, StartType -AutoSize

Write-Host "`nInstalled. This server will shut down $MaxAgeDays days from now."
Write-Host "Log: $InstallDir\SelfShutdown.log   Hold: create $InstallDir\KeepUntil.txt containing a date (e.g. 2026-12-20)."
