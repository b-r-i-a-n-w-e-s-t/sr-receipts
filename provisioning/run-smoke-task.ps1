<#
.SYNOPSIS
  Run the registered smoke entry point and return its task result.

.DESCRIPTION
  The smoke must run under the limited, interactive `nvda-smoke` task rather
  than the (possibly elevated) provisioning shell. Removing the two artifacts
  before starting makes it impossible for a prior result to satisfy the health
  report.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$rig = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $rig 'artifacts'
$smokeArtifact = Join-Path $artifactDirectory 'smoke-log.txt'
$taskOutput = Join-Path $artifactDirectory 'smoke-task.out'

New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $smokeArtifact, $taskOutput

$task = Get-ScheduledTask -TaskName 'nvda-smoke' -ErrorAction Stop
$startedAt = Get-Date
Start-ScheduledTask -InputObject $task
$deadline = $startedAt.AddMinutes(10)
do {
  Start-Sleep -Milliseconds 500
  $task = Get-ScheduledTask -TaskName 'nvda-smoke'
  $info = Get-ScheduledTaskInfo -TaskName 'nvda-smoke'
  if ((Get-Date) -gt $deadline) {
    throw 'nvda-smoke did not finish within ten minutes.'
  }
} while ($task.State -eq 'Running' -or $info.LastRunTime -lt $startedAt)

$result = $info.LastTaskResult
Write-Output "nvda-smoke LastTaskResult: $result"
if ($result -ne 0) {
  exit $result
}
