param(
  [string]$TaskName = "SS Monitor Local Douyin CDP Sync",
  [string]$ScriptPath = ""
)

$ErrorActionPreference = "Stop"

if (!$ScriptPath) {
  $ScriptPath = Join-Path $PSScriptRoot "sync-local-douyin-cdp.ps1"
}

$resolvedScript = Resolve-Path -LiteralPath $ScriptPath
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$($resolvedScript.Path)`""

$startAt = (Get-Date).Date.AddMinutes(5)
if ($startAt -lt (Get-Date)) {
  $startAt = (Get-Date).AddMinutes(5)
}

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $startAt `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Runs local BettaFish MediaCrawler Douyin CDP collection, exports text rows, and syncs them to ss-monitor." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
