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
    Start-Process -Wait -FilePath 'msiexec.exe' -ArgumentList @('/i', $download) + $Arguments
  } else {
    Start-Process -Wait -FilePath $download -ArgumentList $Arguments
  }
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
  throw "This manifest supports Windows ARM64 only; found $env:PROCESSOR_ARCHITECTURE."
}

$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node) -and (Get-Command node -ErrorAction SilentlyContinue)) { $node = (Get-Command node).Source }
if (-not (Test-Path $node) -or (& $node --version) -ne "v$($manifest.node.version)") {
  Install-ExactFile $manifest.node @('/qn', '/norestart') -Msi
  $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}

$firefox = Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'
$firefoxVersion = if (Test-Path $firefox) { (Get-Item $firefox).VersionInfo.ProductVersion } else { '' }
if ($firefoxVersion -notlike "$($manifest.firefox.version)*") {
  Install-ExactFile $manifest.firefox @('-ms')
}

Push-Location $rig
try {
  $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
  & $npm ci
  if ($LASTEXITCODE) { throw 'npm ci failed.' }
  & $node node_modules\@guidepup\setup\bin\setup --nvda-install-dir (Join-Path $env:LOCALAPPDATA 'Dogwalk\nvda')
  if ($LASTEXITCODE) { throw 'Guidepup NVDA setup failed.' }

  & $node provisioning\health-report.ts $ReportPath
  $provisionOk = $LASTEXITCODE -eq 0

  $probe = [ordered]@{ attempted = [bool]$HostUrl; ok = $null; url = $HostUrl; failure = $null }
  if ($HostUrl) {
    try { Invoke-WebRequest -Uri $HostUrl -UseBasicParsing -TimeoutSec 10 | Out-Null; $probe.ok = $true }
    catch { $probe.ok = $false; $probe.failure = $_.Exception.Message }
  }
  $report = Get-Content $ReportPath -Raw | ConvertFrom-Json
  $report | Add-Member -NotePropertyName hostUrlProbe -NotePropertyValue $probe
  $report | ConvertTo-Json -Depth 5 | Set-Content $ReportPath
  if (-not $provisionOk) { exit 1 }
} finally {
  Pop-Location
}
