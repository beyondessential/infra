<#
.SYNOPSIS
    Shuts THIS server down after it has been alive for more than a set number of days.

.DESCRIPTION
    Runs as a Windows service (see Install-SelfShutdown.ps1). The clock starts when the
    service is first installed. Once the server is older than -MaxAgeDays it is shut down.
    If someone powers it back on afterwards, the clock restarts and they get another
    -MaxAgeDays before it shuts down again.

    To keep the server alive past the cutoff, create C:\CloneCleanup\KeepUntil.txt
    containing a date like 2026-12-20. The server will not be shut down before that date.

    A warning is written to the log (and Slack, if a webhook URL is given) 24 hours
    before shutdown.
#>
param(
    [int]    $MaxAgeDays      = 7,
    [string] $SlackWebhookUrl = '',      # optional: Slack incoming webhook URL
    [string] $StateDir        = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'

$logPath      = Join-Path $StateDir 'SelfShutdown.log'
$startFile    = Join-Path $StateDir 'clock-started.txt'
$keepFile     = Join-Path $StateDir 'KeepUntil.txt'
$shutdownFlag = Join-Path $StateDir 'shutdown-by-service.txt'
$warnedFlag   = Join-Path $StateDir 'warned.txt'
$hostName     = $env:COMPUTERNAME

function Write-Log {
    param([string]$Message)
    $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $Message
    Add-Content -Path $logPath -Value $line
}

function Send-Slack {
    param([string]$Text)
    if (-not $SlackWebhookUrl) { return }
    try {
        $body = @{ text = $Text } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri $SlackWebhookUrl -Method Post -ContentType 'application/json' -Body $body | Out-Null
    } catch {
        Write-Log "Slack post failed: $($_.Exception.Message)"
    }
}

function Reset-Clock {
    Set-Content -Path $startFile -Value (Get-Date).ToString('o')
    Remove-Item $warnedFlag -ErrorAction SilentlyContinue
}

# --- Startup -------------------------------------------------------------

# If we were the ones who shut it down last time and someone has started it again,
# give them a fresh window rather than shutting down again immediately.
if (Test-Path $shutdownFlag) {
    Remove-Item $shutdownFlag -Force
    Reset-Clock
    Write-Log "Server was powered back on after an automatic shutdown. Clock reset: $MaxAgeDays more days."
    Send-Slack ":arrows_counterclockwise: $hostName was started again after auto-shutdown. It will shut down again in $MaxAgeDays days unless KeepUntil.txt is set."
}

if (-not (Test-Path $startFile)) {
    Reset-Clock
    Write-Log "Clock started. This server will shut down after $MaxAgeDays days."
}

Write-Log "Service started on $hostName (max age $MaxAgeDays days)"

# --- Main loop -----------------------------------------------------------

while ($true) {
    $now      = Get-Date
    $started  = [datetime]::Parse((Get-Content $startFile -Raw).Trim())
    $ageDays  = ($now - $started).TotalDays
    $deadline = $started.AddDays($MaxAgeDays)

    # KeepUntil override
    $keepUntil = $null
    if (Test-Path $keepFile) {
        $raw = (Get-Content $keepFile -Raw).Trim()
        if (-not [datetime]::TryParse($raw, [ref]$keepUntil)) {
            Write-Log "KeepUntil.txt contains '$raw', which is not a date. Ignoring it."
            $keepUntil = $null
        }
    }

    if ($keepUntil -and $now.Date -le $keepUntil.Date) {
        # Held: do nothing, check again later
    }
    elseif ($ageDays -ge $MaxAgeDays) {
        Write-Log ("Server has been alive {0:N1} days (limit {1}). Shutting down." -f $ageDays, $MaxAgeDays)
        Send-Slack ":stop_sign: $hostName has been up $([math]::Round($ageDays,1)) days and is shutting itself down now. Power it on again if you still need it."
        Set-Content -Path $shutdownFlag -Value (Get-Date).ToString('o')
        Start-Sleep -Seconds 10
        Stop-Computer -Force
        Start-Sleep -Seconds 600   # give the OS time to go down; the loop ends with it
    }
    elseif (($deadline - $now).TotalHours -le 24 -and -not (Test-Path $keepFile) -and -not (Test-Path $warnedFlag)) {
        Write-Log ("Warning: shutdown in {0:N1} hours (at {1:yyyy-MM-dd HH:mm})." -f ($deadline - $now).TotalHours, $deadline)
        Send-Slack ":warning: $hostName will shut itself down at $($deadline.ToString('ddd d MMM HH:mm')). To keep it, create C:\CloneCleanup\KeepUntil.txt with a date."
        Set-Content -Path $warnedFlag -Value (Get-Date).ToString('o')
    }

    Start-Sleep -Seconds 600   # check every 10 minutes
}
