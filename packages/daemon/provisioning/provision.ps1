<#
.SYNOPSIS
  Idempotently provision the approved Windows 11 ARM64 Guest Rig.

.DESCRIPTION
  Run this only in a signed-in, unlocked Windows desktop after the manual UTM
  and Windows first-run boundary described in provisioning/README.md. It runs
  from the installed daemon package, which bootstrap.ps1 installs and then
  runs this from. It verifies the exact reviewed Runtime Manifest, configures
  Guidepup's portable NVDA asset, restarts the logon daemon, then proves it:
  real NVDA reading a fixture in the daemon's Edge, through the same routes a
  test on the Mac uses.

  Every manifest step is a named stage whose outcome is recorded rather than
  thrown away, so the health report can tell a dependency failure apart from a
  desktop or speech-capture failure. src/provisioning/health-report.ts owns
  the report, the real NVDA proof and the optional host URL probe; the probe is
  reported beside the verdict and never inside it.
#>
[CmdletBinding()]
param(
  [string]$HostUrl,
  [string]$ReportPath,
  [string]$StagePath
)

$ErrorActionPreference = 'Stop'
# The installed daemon package. Its dependencies are found by asking Node from
# here, never by joining paths, so where npm put them is npm's business.
$rig = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'node.ps1')
# Resolved here, not as parameter defaults: Windows PowerShell binds defaults
# before the script's own $PSScriptRoot exists, so `-File provision.ps1` from a
# prompt died on an empty path before the provisioner did anything at all.
if (-not $ReportPath) { $ReportPath = Join-Path $RigState 'health-report.json' }
if (-not $StagePath) { $StagePath = Join-Path $RigState 'artifacts\provision-stages.json' }
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

# ------------------------------------------------- stages Node itself needs

$nodeHome = Get-RigNodeHome $manifest
$node = Join-Path $nodeHome 'node.exe'

Invoke-Stage 'architecture' {
  if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
    throw "This manifest supports Windows ARM64 only; found $env:PROCESSOR_ARCHITECTURE."
  }
  Set-StageDetail $env:PROCESSOR_ARCHITECTURE
}

Invoke-Stage 'node' {
  Set-StageDetail (Install-RigNode $manifest)
}

<#
  src/provisioning/health-report.ts owns the report. This is the only report
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
    schemaVersion = 5
    ok = $false
    fixture = 'control.html'
    execution = "the logon daemon, as a test uses it: real NVDA and headed Edge through the daemon's routes and browser server"
    checks = [ordered]@{
      runtimeInstalled = $runtimeInstalled; daemonAnswered = $false; smokePassed = $false
      speechCaptured = $false; transcriptArtifact = $false
    }
    runtime = @($stages)
    artifacts = [ordered]@{ transcript = '' }
    hostUrlProbe = [ordered]@{ attempted = $false; ok = $null; url = $probeUrl; failure = $probeFailure }
    observed = [ordered]@{
      reporterNode = $reporterNode
      reporterPlatform = 'win32'
      reporterArchitecture = $env:PROCESSOR_ARCHITECTURE
      transcriptBytes = 0
      smokeOutput = ''
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

<#
  What Node resolves from the daemon package: a dependency's version or file,
  wherever npm put it. Throws when Node cannot resolve it, which is a broken or
  missing install.
#>
function Resolve-FromRig {
  param([Parameter(Mandatory)][string]$Expression)
  Push-Location $rig
  try {
    $resolved = & $node -p $Expression
    if ($LASTEXITCODE) { throw "Node could not resolve $Expression from $rig." }
    $resolved
  } finally {
    Pop-Location
  }
}

# ---------------------------------------------------- the rest of the runtime

# The state directory is where the reporter and the Smoke write, and where the
# daemon runs from.
New-Item -ItemType Directory -Force -Path $RigState | Out-Null
Push-Location $RigState
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
    # bootstrap.ps1 installed the package's dependencies from its shrinkwrap
    # before this ran. What is checked is what Node will load, not the fact
    # that a command ran: these are the reviewed components the shrinkwrap
    # exists to pin. playwright-core is the browser server a
    # Mac's Playwright connects to, which only works between the same
    # major.minor, so its version is what consumers match.
    $guidepup = Resolve-FromRig "require('@guidepup/guidepup/package.json').version"
    if ($guidepup -ne $manifest.guidepup.version) {
      throw "the daemon resolves @guidepup/guidepup $guidepup, not the reviewed $($manifest.guidepup.version)."
    }
    $playwright = Resolve-FromRig "require('playwright-core/package.json').version"
    if ($playwright -ne $manifest.playwright.version) {
      throw "the daemon resolves playwright-core $playwright, not the reviewed $($manifest.playwright.version)."
    }
    Set-StageDetail "@guidepup/guidepup $guidepup, playwright-core $playwright, as the daemon package resolves them"
  }

  Invoke-Stage 'guidepup-nvda' {
    $guidepup = Resolve-FromRig "require.resolve('@guidepup/setup/bin/guidepup')"
    # Guidepup's setup looks for @guidepup/guidepup from the directory it is
    # run in, not from where it is installed, so both commands run in the
    # package rather than the state directory.
    Push-Location $rig
    try {
      # On Windows `setup` is intentionally a no-op today, but keeping the
      # documented lifecycle explicit makes a future Guidepup setup action part
      # of this reviewed provisioner rather than an untracked manual step.
      & $node $guidepup setup
      if ($LASTEXITCODE) { throw "Guidepup environment setup exited $LASTEXITCODE." }
      & $node $guidepup install nvda
      if ($LASTEXITCODE) { throw "Guidepup NVDA setup exited $LASTEXITCODE." }
    } finally {
      Pop-Location
    }
    # The asset cache src/lib/stamp.ts reads, so the detail is the NVDA build that
    # landed rather than the manifest's intention that it should.
    $cache = Join-Path $env:LOCALAPPDATA 'guidepup\nvda\all'
    $assets = @(Get-ChildItem -Path $cache -ErrorAction SilentlyContinue)
    if (-not $assets) { throw "Guidepup installed no NVDA asset under $cache." }
    Set-StageDetail ($assets.Name -join ', ')
  }

  Invoke-Stage 'tasks' {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $rig 'tasks\register.ps1')
    if ($LASTEXITCODE) { throw "Interactive task registration exited $LASTEXITCODE." }
    # Read the tasks back, so the detail is what Windows now holds rather than
    # a claim that a registration script ran.
    $registered = Get-ScheduledTask -TaskName 'nvda-daemon' -ErrorAction Stop
    Set-StageDetail (
      ($registered | ForEach-Object { "$($_.TaskName) ($($_.Principal.RunLevel), $($_.Principal.LogonType))" }) -join ', '
    )
  }

  <#
    The Smoke is a client of the daemon a test uses, so the daemon has to be
    the one just provisioned. Stopping the task ends only its cmd.exe;
    run-daemon.cmd ends the node that kept the port, from the pid file, before
    starting the new one. The reporter's Smoke needs what the logon task
    inherits from the user's environment, which this process does not see
    until it is copied in.
  #>
  Invoke-Stage 'daemon' {
    $task = Get-ScheduledTask -TaskName 'nvda-daemon' -ErrorAction Stop
    if ($task.State -eq 'Running') {
      Stop-ScheduledTask -InputObject $task
      Start-Sleep -Seconds 2
    }
    Start-ScheduledTask -InputObject $task
    Start-Sleep -Seconds 2
    $task = Get-ScheduledTask -TaskName 'nvda-daemon'
    if ($task.State -ne 'Running') { throw "nvda-daemon is $($task.State) after Start-ScheduledTask; a stopped daemon cannot be proved." }
    $env:RIG_TOKEN = [Environment]::GetEnvironmentVariable('RIG_TOKEN', 'User')
    $env:RIG_PORT = [Environment]::GetEnvironmentVariable('RIG_PORT', 'User')
    $env:RIG_BROWSER_PORT = [Environment]::GetEnvironmentVariable('RIG_BROWSER_PORT', 'User')
    if (-not $env:RIG_TOKEN) { throw 'RIG_TOKEN is not set for this user; tasks\register.ps1 sets it, and the Smoke cannot reach the daemon without it.' }
    Set-StageDetail "nvda-daemon $($task.State) on port $($env:RIG_PORT), RIG_TOKEN in the reporter's environment"
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
  $reportArgs = @((Join-Path $rig 'dist\provisioning\health-report.js'), $ReportPath, '--stages', $StagePath)
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
