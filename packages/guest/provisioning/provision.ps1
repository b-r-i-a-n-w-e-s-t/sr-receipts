<#
.SYNOPSIS
  Idempotently provision the approved Windows 11 ARM64 Guest Rig.

.DESCRIPTION
  Run this only in a signed-in, unlocked Windows desktop after the manual UTM
  and Windows first-run boundary described in provisioning/README.md. It
  installs the exact reviewed Runtime Manifest, configures Guidepup's portable
  NVDA asset, then proves real NVDA reading a fixture in headed Edge.

  Every manifest step is a named stage whose outcome is recorded rather than
  thrown away, so the health report can tell a dependency failure apart from a
  desktop or speech-capture failure. provisioning/health-report.ts owns the
  report, the real NVDA proof and the optional host URL probe; the probe is
  reported beside the verdict and never inside it.
#>
[CmdletBinding()]
param(
  [string]$HostUrl,
  [string]$ReportPath,
  [string]$StagePath
)

$ErrorActionPreference = 'Stop'
$rig = Split-Path -Parent $PSScriptRoot
# The guest is a workspace package: the lockfile and node_modules live two
# levels up, at the repository root.
$workspace = Split-Path -Parent (Split-Path -Parent $rig)
# Resolved here, not as parameter defaults: Windows PowerShell binds defaults
# before the script's own $PSScriptRoot exists, so `-File provision.ps1` from a
# prompt died on an empty path before the provisioner did anything at all.
if (-not $ReportPath) { $ReportPath = Join-Path $PSScriptRoot 'health-report.json' }
if (-not $StagePath) { $StagePath = Join-Path $rig 'artifacts\provision-stages.json' }
$manifest = Get-Content (Join-Path $PSScriptRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
$stages = [Collections.Generic.List[object]]::new()

function Test-StagesHealthy { @($stages | Where-Object { -not $_.ok }).Count -eq 0 }

<#
  A stage's evidence detail: what is now on disk, observed, rather than a claim
  that a command ran. Set explicitly instead of taken from the step's output,
  because the steps run installers. Capturing or piping a native command would
  both swallow the chatter a maintainer watches and, under
  $ErrorActionPreference = 'Stop', turn npm's progress-on-stderr into a
  terminating NativeCommandError that records a successful install as a failed
  stage. Unpiped native output goes straight to the console, as it always has.
#>
function Set-StageDetail {
  param([Parameter(Mandatory)][string]$Detail)
  $script:StageDetail = $Detail
}

<#
  Run one Runtime Manifest step, recording its outcome. Once a stage has failed
  the rest are skipped, because installing on top of a broken dependency
  produces cascading noise instead of a diagnosis.
#>
function Invoke-Stage {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Step)
  if (-not (Test-StagesHealthy)) {
    $stages.Add([ordered]@{ name = $Name; ok = $false; detail = 'skipped: an earlier stage failed' })
    return
  }
  try {
    $script:StageDetail = ''
    & $Step
    # A stage that records no evidence has not proved its component is there.
    if (-not $script:StageDetail) { throw "$Name recorded no evidence of what it installed." }
    $stages.Add([ordered]@{ name = $Name; ok = $true; detail = $script:StageDetail })
    Write-Host "  $Name ok: $($script:StageDetail)" -ForegroundColor Green
  } catch {
    $stages.Add([ordered]@{ name = $Name; ok = $false; detail = $_.Exception.Message })
    Write-Host "  $Name FAILED: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Get-ExactFile {
  param([pscustomobject]$Component)
  $download = Join-Path $env:TEMP ([IO.Path]::GetFileName(([uri]$Component.url).LocalPath))
  # -UseBasicParsing keeps Windows PowerShell off the IE engine, which a fresh
  # guest has never launched.
  Invoke-WebRequest -Uri $Component.url -OutFile $download -UseBasicParsing
  if ((Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Component.sha256) {
    throw "Checksum mismatch for $($Component.url)"
  }
  $download
}

function Get-NodeVersion {
  param([string]$Node)
  if (-not (Test-Path $Node)) { return '' }
  & $Node --version
}

# ------------------------------------------------- stages Node itself needs

$nodeHome = Join-Path $env:LOCALAPPDATA "nvda-rig\node-v$($manifest.node.version)-win-arm64"
$node = Join-Path $nodeHome 'node.exe'

Invoke-Stage 'architecture' {
  if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
    throw "This manifest supports Windows ARM64 only; found $env:PROCESSOR_ARCHITECTURE."
  }
  Set-StageDetail $env:PROCESSOR_ARCHITECTURE
}

Invoke-Stage 'node' {
  $expected = "v$($manifest.node.version)"
  if ((Get-NodeVersion $node) -ne $expected) {
    $download = Get-ExactFile $manifest.node
    Write-Host "  installing Node $expected" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $nodeHome) | Out-Null
    Expand-Archive -Path $download -DestinationPath (Split-Path -Parent $nodeHome) -Force
  }
  $installed = Get-NodeVersion $node
  if ($installed -ne $expected) {
    throw "Node installation verification failed; expected $expected, found '$installed'."
  }
  Set-StageDetail "$installed at $nodeHome"
}

<#
  provisioning/health-report.ts owns the report. This is the only report
  PowerShell writes, for the two cases where the reporter cannot: Node is not
  installed, or the reporter failed before writing a file. It is deliberately
  minimal, because no proof ran, but it keeps its shape so a maintainer and any
  tooling always find a valid UTF-8 report where they expect one. The host URL
  probe belongs to the reporter, so it is recorded here as not attempted.
  test/provisioning.test.ts holds this literal to the HealthReport type.
#>
function Write-FallbackReport {
  param([Parameter(Mandatory)][string]$Failure)
  # An asked-for probe that could not run is not the same as one nobody asked
  # for, so say which this was. Kept out of the literal below because the
  # drift test reads that literal, and a brace in it would truncate the read.
  $probeUrl = $null
  $probeFailure = $null
  if ($HostUrl) {
    $probeUrl = $HostUrl
    $probeFailure = 'not attempted: the reporter owns the probe and could not run'
  }
  # Node's version is knowable whenever Node itself installed, and the stage
  # list already says whether the runtime is there: neither may be asserted
  # false here, or the one artifact a maintainer reads contradicts itself.
  $runtimeInstalled = Test-StagesHealthy
  $reporterNode = ''
  if (Test-Path $node) { $reporterNode = (& $node --version) }
  $fallback = [ordered]@{
    schemaVersion = 4
    ok = $false
    fixture = 'control.html'
    execution = 'unelevated interactive scheduled task: real NVDA with headed Edge'
    checks = [ordered]@{
      runtimeInstalled = $runtimeInstalled; taskCompleted = $false; smokePassed = $false
      speechCaptured = $false; speechArtifact = $false
      scheduledCmdNode = $false; freshArtifact = $false
    }
    runtime = @($stages)
    artifacts = [ordered]@{ result = ''; speech = '' }
    hostUrlProbe = [ordered]@{ attempted = $false; ok = $null; url = $probeUrl; failure = $probeFailure }
    observed = [ordered]@{
      reporterNode = $reporterNode
      reporterPlatform = 'win32'
      reporterArchitecture = $env:PROCESSOR_ARCHITECTURE
      speechArtifactBytes = 0
      taskOutput = ''
    }
    failure = $Failure
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
  [IO.File]::WriteAllText(
    $ReportPath,
    ($fallback | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )
  Write-Host "Unprovisioned: $Failure. See $ReportPath" -ForegroundColor Red
}

if (-not (Test-StagesHealthy)) {
  $failed = $stages | Where-Object { -not $_.ok } | Select-Object -First 1
  Write-FallbackReport "no provisioned runtime: $($failed.name) failed before Node was available: $($failed.detail)"
  exit 1
}

# ---------------------------------------------------- the rest of the runtime

Push-Location $rig
try {
  # Edge is the one browser Windows on ARM64 ships and Playwright can drive
  # natively; it is verified present, never installed. Its version is recorded,
  # not pinned: Windows updates it, and the Environment Stamp names it per run.
  Invoke-Stage 'edge' {
    $edge = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $edge) { throw 'no msedge.exe under Program Files; Edge ships with Windows 11 and is required.' }
    Set-StageDetail "$((Get-Item $edge).VersionInfo.ProductVersion) at $edge"
  }

  Invoke-Stage 'packages' {
    # From the workspace root, which is the only place `npm ci` honours the
    # committed lockfile for every package.
    Push-Location $workspace
    try {
      & (Join-Path (Split-Path -Parent $node) 'npm.cmd') ci
      if ($LASTEXITCODE) { throw "npm ci exited $LASTEXITCODE." }
    } finally {
      Pop-Location
    }
    # The installed versions, not the fact that a command ran: they are the
    # reviewed components this stage exists to put on disk. playwright-core is
    # the browser server a Mac's Playwright connects to, which only works
    # between the same major.minor, so its version is what consumers match.
    $installed = Get-Content (Join-Path $workspace 'node_modules\@guidepup\guidepup\package.json') -Raw | ConvertFrom-Json
    if ($installed.version -ne $manifest.guidepup.version) {
      throw "npm ci installed @guidepup/guidepup $($installed.version), not the reviewed $($manifest.guidepup.version)."
    }
    $playwright = Get-Content (Join-Path $workspace 'node_modules\playwright-core\package.json') -Raw | ConvertFrom-Json
    if ($playwright.version -ne $manifest.playwright.version) {
      throw "npm ci installed playwright-core $($playwright.version), not the reviewed $($manifest.playwright.version)."
    }
    Set-StageDetail "@guidepup/guidepup $($installed.version), playwright-core $($playwright.version) from the committed lockfile"
  }

  Invoke-Stage 'guidepup-nvda' {
    $guidepup = Join-Path $workspace 'node_modules\@guidepup\setup\bin\guidepup'
    # On Windows `setup` is intentionally a no-op today, but keeping the
    # documented lifecycle explicit makes a future Guidepup setup action part
    # of this reviewed provisioner rather than an untracked manual step.
    & $node $guidepup setup
    if ($LASTEXITCODE) { throw "Guidepup environment setup exited $LASTEXITCODE." }
    & $node $guidepup install nvda
    if ($LASTEXITCODE) { throw "Guidepup NVDA setup exited $LASTEXITCODE." }
    # The asset cache lib/stamp.ts reads, so the detail is the NVDA build that
    # landed rather than the manifest's intention that it should.
    $cache = Join-Path $env:LOCALAPPDATA 'guidepup\nvda\all'
    $assets = @(Get-ChildItem -Path $cache -ErrorAction SilentlyContinue)
    if (-not $assets) { throw "Guidepup installed no NVDA asset under $cache." }
    Set-StageDetail ($assets.Name -join ', ')
  }

  Invoke-Stage 'tasks' {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tasks\register.ps1
    if ($LASTEXITCODE) { throw "Interactive task registration exited $LASTEXITCODE." }
    # Read the tasks back, so the detail is what Windows now holds rather than
    # a claim that a registration script ran.
    $registered = Get-ScheduledTask -TaskName 'nvda-smoke', 'nvda-daemon' -ErrorAction Stop
    Set-StageDetail (
      ($registered | ForEach-Object { "$($_.TaskName) ($($_.Principal.RunLevel), $($_.Principal.LogonType))" }) -join ', '
    )
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StagePath) | Out-Null
  [IO.File]::WriteAllText(
    $StagePath,
    (ConvertTo-Json -Depth 5 -InputObject @($stages)),
    [Text.UTF8Encoding]::new($false)
  )

  # The reporter runs even when a stage failed: a named failed stage in the
  # report is the actionable evidence, and it still reports the host URL probe.
  # Clear the last run's report first, so a stale `ok: true` from yesterday can
  # never stand in for a report this run failed to write.
  Remove-Item -Force -ErrorAction SilentlyContinue $ReportPath
  $reportArgs = @('provisioning\health-report.ts', $ReportPath, '--stages', $StagePath)
  if ($HostUrl) { $reportArgs += @('--host-url', $HostUrl) }
  & $node @reportArgs
  $reporterExit = $LASTEXITCODE
  if (-not (Test-Path $ReportPath)) {
    Write-FallbackReport "health reporter failed with exit code $reporterExit"
  }
  if ($reporterExit) { exit 1 }
} finally {
  Pop-Location
}
