<#
.SYNOPSIS
  Run the registered smoke entry point and await this invocation's result.
.DESCRIPTION
  Completion is a run-specific JSON result written by smoke.ts, never scheduler
  wall-clock state. On timeout, stop the task and remove its control artifacts.
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$RunId)

$ErrorActionPreference = 'Stop'
$rig = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $rig 'artifacts'
$request = Join-Path $artifactDirectory 'smoke-request.json'
$result = Join-Path $artifactDirectory "smoke-result-$RunId.json"
$smokeArtifact = Join-Path $artifactDirectory "smoke-log-$RunId.txt"
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $result, $smokeArtifact
$requestValue = [ordered]@{ runId = $RunId; resultArtifact = $result; smokeArtifact = $smokeArtifact } |
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
      Remove-Item -Force -ErrorAction SilentlyContinue $request, $result, $smokeArtifact
      throw 'nvda-smoke did not write its run result within ten minutes; task stopped and run artifacts removed.'
    }
  } while ($task.State -eq 'Running' -or -not (Test-Path $result))
  $smoke = Get-Content $result -Raw | ConvertFrom-Json
  if (-not $smoke.ok) { throw 'nvda-smoke completed but reported an unhealthy smoke result.' }
  Write-Output "nvda-smoke result: $result"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $request
}
