# Clone self-shutdown service (Windows)

A small Windows service that shuts a clone server down after it has been alive for a set
number of days (default 7), so clones stop running past when they are needed without anyone
having to remember to turn them off.

It runs on the clone itself and only acts on that server. It has no cloud or hosting
dependencies and never deletes anything: the clone is powered off, not removed.

## Files

| File | Purpose |
| --- | --- |
| `Install-SelfShutdown.ps1` | Run once on the clone as Administrator. Copies the script to `C:\CloneCleanup`, fetches NSSM, registers and starts the service. |
| `SelfShutdown.ps1` | The service itself. Keeps the start date in a file, checks every 10 minutes, shuts the server down when the limit is reached. |

## Install

Put both files in the same folder on the clone, open PowerShell as Administrator, and run:

```powershell
.\Install-SelfShutdown.ps1                 # 7 days
.\Install-SelfShutdown.ps1 -MaxAgeDays 3   # different cutoff
```

Optional: add `-SlackWebhookUrl https://hooks.slack.com/services/...` to post a warning 24 h
before shutdown, a note at shutdown, and a note if the server is powered back on.

The installer needs internet access once to download NSSM (https://nssm.cc), which is what
lets a PowerShell script run as a Windows service. If the clone has no internet, download
`nssm.exe` yourself into `C:\CloneCleanup` first and the installer will skip the download.

Uninstall with `.\Install-SelfShutdown.ps1 -Uninstall`.

## Behaviour

- The clock starts when the service is first installed.
- The service starts automatically on boot. A reboot does not reset the clock.
- When 24 hours remain, a warning is written to the log (and Slack if configured).
- At the limit the server is shut down with `Stop-Computer -Force`.
- If someone powers the server back on afterwards, the clock resets and they get another
  full window before it shuts down again.

## Keeping a clone longer

Create `C:\CloneCleanup\KeepUntil.txt` containing a date, e.g. `2026-12-20`. The server
will not be shut down until that date has passed. Delete the file to return to the normal rule.

```powershell
Set-Content C:\CloneCleanup\KeepUntil.txt 2026-12-20
```

## Logs

`C:\CloneCleanup\SelfShutdown.log` records every decision the service makes. NSSM writes
service stdout/stderr to `service-stdout.log` and `service-stderr.log` in the same folder.
