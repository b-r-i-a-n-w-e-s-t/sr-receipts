<#
.SYNOPSIS
  Run the registered smoke entry point and await this invocation's result.
.DESCRIPTION
  Completion is a run-specific JSON result written by smoke.ts, never scheduler
  wall-clock state. On timeout, stop the task and remove its control artifacts.

  The caller owns both artifact paths: provisioning/health-report.ts derives
  them from lib/smoke-result.ts, so no two scripts can name a run's evidence
  differently.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$RunId,
  [Parameter(Mandatory)][string]$Result,
  [Parameter(Mandatory)][string]$Speech
)

$ErrorActionPreference = 'Stop'
$rig = Split-Path -Parent $PSScriptRoot
$request = Join-Path $rig 'artifacts\smoke-request.json'
foreach ($artifact in @($request, $Result, $Speech)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $artifact) | Out-Null
}
Remove-Item -Force -ErrorAction SilentlyContinue $Result, $Speech
# The SmokeRequest contract from lib/smoke-result.ts, which smoke.ts reads.
$requestValue = [ordered]@{ runId = $RunId; result = $Result; speech = $Speech } |
  ConvertTo-Json -Compress
[IO.File]::WriteAllText($request, $requestValue, [Text.UTF8Encoding]::new($false))
$task = Get-ScheduledTask -TaskName 'nvda-smoke' -ErrorAction Stop
Start-ScheduledTask -InputObject $task
$deadline = (Get-Date).AddMinutes(10)
try {
  do {
    Start-Sleep -Milliseconds 500
    $task = Get-ScheduledTask -TaskName 'nvda-smoke'
    if ((Get-Date) -gt $deadline) {
      Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue
      Remove-Item -Force -ErrorAction SilentlyContinue $request, $Result, $Speech
      throw 'nvda-smoke did not write its run result within ten minutes; task stopped and run artifacts removed.'
    }
  } while ($task.State -eq 'Running' -or -not (Test-Path $Result))
  $smoke = Get-Content $Result -Raw | ConvertFrom-Json
  if (-not $smoke.ok) { throw 'nvda-smoke completed but reported an unhealthy smoke result.' }
  Write-Output "nvda-smoke result: $Result"
  Write-Output "nvda-smoke speech log: $Speech"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $request
}
