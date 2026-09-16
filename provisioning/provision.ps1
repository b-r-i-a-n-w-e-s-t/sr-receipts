<#
.SYNOPSIS
  Idempotently provision the approved Windows 11 ARM64 Guest Rig.

.DESCRIPTION
  Run this only in a signed-in, unlocked Windows desktop after the manual UTM
  and Windows first-run boundary described in provisioning/README.md. It
  installs the exact reviewed Runtime Manifest, configures Guidepup's portable
  NVDA asset, then proves the real headed NVDA/Firefox fixture. The optional
  host URL probe is reported separately and never changes the provision verdict.
#>
[CmdletBinding()]
param(
  [string]$HostUrl,
  [string]$ReportPath = (Join-Path $PSScriptRoot 'health-report.json')
)

$ErrorActionPreference = 'Stop'
$rig = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $PSScriptRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json

function Install-ExactFile {
  param([pscustomobject]$Component, [string[]]$Arguments, [switch]$Msi)
  $download = Join-Path $env:TEMP ([IO.Path]::GetFileName(([uri]$Component.url).LocalPath))
  Invoke-WebRequest -Uri $Component.url -OutFile $download
  if ((Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Component.sha256) {
    throw "Checksum mismatch for $($Component.url)"
  }
  if ($Msi) {
    $process = Start-Process -Wait -PassThru -FilePath 'msiexec.exe' `
      -ArgumentList (@('/i', "`"$download`"") + $Arguments)
  } else {
    $process = Start-Process -Wait -PassThru -FilePath $download -ArgumentList $Arguments
  }
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Installer failed for $($Component.url) with exit code $($process.ExitCode)."
  }
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
  throw "This manifest supports Windows ARM64 only; found $env:PROCESSOR_ARCHITECTURE."
}

$nodeHome = Join-Path $env:LOCALAPPDATA "nvda-rig\node-v$($manifest.node.version)-win-arm64"
$node = Join-Path $nodeHome 'node.exe'
if (-not (Test-Path $node) -or (& $node --version) -ne "v$($manifest.node.version)") {
  $download = Join-Path $env:TEMP ([IO.Path]::GetFileName(([uri]$manifest.node.url).LocalPath))
  Invoke-WebRequest -Uri $manifest.node.url -OutFile $download
  if ((Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.node.sha256) {
    throw "Checksum mismatch for $($manifest.node.url)"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $nodeHome) | Out-Null
  Expand-Archive -Path $download -DestinationPath (Split-Path -Parent $nodeHome) -Force
}
if (-not (Test-Path $node) -or (& $node --version) -ne "v$($manifest.node.version)") {
  throw "Node installation verification failed; expected v$($manifest.node.version)."
}

$firefox = Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'
$firefoxVersion = if (Test-Path $firefox) { (Get-Item $firefox).VersionInfo.ProductVersion } else { '' }
if ($firefoxVersion -notlike "$($manifest.firefox.version)*") {
  Install-ExactFile $manifest.firefox @('-ms')
  $firefoxVersion = if (Test-Path $firefox) { (Get-Item $firefox).VersionInfo.ProductVersion } else { '' }
  if ($firefoxVersion -notlike "$($manifest.firefox.version)*") {
    throw "Firefox installation verification failed; expected $($manifest.firefox.version), found $firefoxVersion."
  }
}

Push-Location $rig
try {
  $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
  & $npm ci
  if ($LASTEXITCODE) { throw 'npm ci failed.' }
  # On Windows `setup` is intentionally a no-op today, but keeping the
  # documented lifecycle explicit makes a future Guidepup setup action part of
  # this reviewed provisioner rather than an untracked manual prerequisite.
  & $node node_modules\@guidepup\setup\bin\guidepup setup
  if ($LASTEXITCODE) { throw 'Guidepup environment setup failed.' }
  & $node node_modules\@guidepup\setup\bin\guidepup install nvda
  if ($LASTEXITCODE) { throw 'Guidepup NVDA setup failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tasks\register.ps1
  if ($LASTEXITCODE) { throw 'Interactive task registration failed.' }

  # The reporter normally owns this file. Retain a valid, UTF-8 failure report
  # even if Node cannot start or the reporter itself fails before writing one.
  & $node provisioning\health-report.ts $ReportPath
  $reporterExit = $LASTEXITCODE
  $provisionOk = $reporterExit -eq 0
  if (-not (Test-Path $ReportPath)) {
    $fallback = [ordered]@{
      schemaVersion = 2
      ok = $false
      fixture = 'control.html'
      execution = 'unelevated interactive scheduled task: real NVDA with headed Firefox'
      checks = [ordered]@{
        taskCompleted = $false; smokePassed = $false; speechCaptured = $false
        focusRetained = $false; scheduledCmdNode = $false; freshArtifact = $false
      }
      artifact = $null
      observed = [ordered]@{
        reporterNode = (& $node --version)
        reporterPlatform = 'win32'
        reporterArchitecture = $env:PROCESSOR_ARCHITECTURE
        taskOutput = ''
      }
      failure = "health reporter failed with exit code $reporterExit"
    }
    [IO.File]::WriteAllText(
      $ReportPath,
      ($fallback | ConvertTo-Json -Depth 5),
      [Text.UTF8Encoding]::new($false)
    )
  }

  $probe = [ordered]@{ attempted = [bool]$HostUrl; ok = $null; url = $HostUrl; failure = $null }
  if ($HostUrl) {
    try { Invoke-WebRequest -Uri $HostUrl -UseBasicParsing -TimeoutSec 10 | Out-Null; $probe.ok = $true }
    catch { $probe.ok = $false; $probe.failure = $_.Exception.Message }
  }
  $report = Get-Content $ReportPath -Raw | ConvertFrom-Json
  $report | Add-Member -NotePropertyName hostUrlProbe -NotePropertyValue $probe
  [IO.File]::WriteAllText(
    $ReportPath,
    ($report | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )
  if (-not $provisionOk) { exit 1 }
} finally {
  Pop-Location
}
