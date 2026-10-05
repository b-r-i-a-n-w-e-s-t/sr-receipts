<#
.SYNOPSIS
  Install or upgrade the daemon on a Windows Guest Rig, then provision it.

.DESCRIPTION
  The one script a guest needs before anything else is on it. For an exact
  version of @sr-receipts/daemon it stops a running daemon, unpacks the
  package into the rig's state directory, installs the Runtime Manifest's
  pinned Node, installs the package's dependencies from its shrinkwrap, and
  runs the Provisioner inside it. Run it again with a later version to
  upgrade; it is idempotent.

  Run it in the signed-in, unlocked desktop, as the Provisioner requires.
  Fetch it for the version it installs, from the published package:

    $v = '0.2.0'
    Invoke-WebRequest "https://cdn.jsdelivr.net/npm/@sr-receipts/daemon@$v/provisioning/bootstrap.ps1" -OutFile bootstrap.ps1 -UseBasicParsing
    powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Version $v

  To try a package that is not published, give it a tarball made by
  `npm pack` on the Mac instead of a version. Its dependencies are resolved
  when it installs, since only a release carries a shrinkwrap:

    powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Tarball sr-receipts-daemon-0.2.0.tgz

.PARAMETER Version
  The exact @sr-receipts/daemon version to install.

.PARAMETER Tarball
  A packed @sr-receipts/daemon to install instead of a published version.

.PARAMETER HostUrl
  Passed to the Provisioner, which reports whether the guest can reach it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, ParameterSetName = 'Version')][string]$Version,
  [Parameter(Mandatory, ParameterSetName = 'Tarball')][string]$Tarball,
  [string]$HostUrl
)

$ErrorActionPreference = 'Stop'
$package = '@sr-receipts/daemon'

# ------------------------------------------------------------- the package

# Fetched and unpacked without npm, because npm cannot run before Node is
# installed, and which Node is the package's manifest's decision. A published
# one is checked against the registry's integrity record first, as npm itself
# would check it.
if ($Version) {
  $meta = Invoke-RestMethod -Uri "https://registry.npmjs.org/$package/$Version" -UseBasicParsing
  $Tarball = Join-Path $env:TEMP "sr-receipts-daemon-$Version.tgz"
  Invoke-WebRequest -Uri $meta.dist.tarball -OutFile $Tarball -UseBasicParsing
  $algorithm, $expected = $meta.dist.integrity -split '-', 2
  if ($algorithm -ne 'sha512') { throw "$package@$Version has a $algorithm integrity record; expected sha512." }
  $actual = [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($Tarball)))
  if ($actual -ne $expected) { throw "$package@$Version does not match the registry's integrity record." }
}
$Tarball = (Resolve-Path $Tarball).Path
# The directory provisioning\node.ps1 names, which is not unpacked yet.
$RigState = Join-Path $env:LOCALAPPDATA 'nvda-rig'
$install = Join-Path $RigState 'daemon'

# -------------------------------------------------------- a running daemon

# An upgrade replaces the package the daemon is running from. Stopping the
# task ends only its cmd.exe, and the node it started keeps the port and its
# files, so that node is ended from the pid file it wrote.
$task = Get-ScheduledTask -TaskName 'nvda-daemon' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
  Stop-ScheduledTask -InputObject $task
}
$pidFile = Join-Path $RigState 'artifacts\daemon.pid'
if (Test-Path $pidFile) {
  $daemon = [int](Get-Content $pidFile -Raw).Trim()
  Stop-Process -Id $daemon -Force -ErrorAction SilentlyContinue
  Wait-Process -Id $daemon -Timeout 10 -ErrorAction SilentlyContinue
  Remove-Item -Force $pidFile
}
# A daemon whose pid file is somewhere else, such as one running from a git
# checkout of the repository, would keep the ports the new one needs, so
# whatever is listening on them is ended too.
$port = [Environment]::GetEnvironmentVariable('RIG_PORT', 'User')
if (-not $port) { $port = 8765 }
$browserPort = [Environment]::GetEnvironmentVariable('RIG_BROWSER_PORT', 'User')
if (-not $browserPort) { $browserPort = [int]$port + 1 }
$holders = Get-NetTCPConnection -State Listen -LocalPort ([int]$port), ([int]$browserPort) -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($holder in $holders) {
  Write-Host "Ending $((Get-Process -Id $holder -ErrorAction SilentlyContinue).ProcessName) ($holder), which holds the daemon's ports." -ForegroundColor Yellow
  Stop-Process -Id $holder -Force -ErrorAction SilentlyContinue
  Wait-Process -Id $holder -Timeout 10 -ErrorAction SilentlyContinue
}

# -------------------------------------------------------------- unpacked

# Replaced whole, so nothing from an earlier version survives in it. A
# directory that cannot be removed stops the script rather than being
# unpacked over.
if (Test-Path $install) { Remove-Item -Recurse -Force $install }
New-Item -ItemType Directory -Force -Path $install | Out-Null
# Windows' own bsdtar, by path: a GNU tar earlier on the path, such as Git's,
# reads `C:\...` as a remote host.
& (Join-Path $env:SystemRoot 'System32\tar.exe') -xzf $Tarball -C $install --strip-components=1
if ($LASTEXITCODE) { throw "tar could not unpack $Tarball into $install." }
. (Join-Path $install 'provisioning\node.ps1')
$manifest = Get-Content (Join-Path $install 'provisioning\runtime-manifest.json') -Raw | ConvertFrom-Json

# -------------------------------------------------------------------- Node

Write-Host "Node: $(Install-RigNode $manifest)" -ForegroundColor Green
$nodeHome = Get-RigNodeHome $manifest
# npm's own child processes look for node on the path.
$env:Path = "$nodeHome;$env:Path"

# ------------------------------------------------------- the dependencies

# A release carries npm-shrinkwrap.json, and `npm ci` inside the package makes
# it the root lockfile, which npm always follows. `npm install
# @sr-receipts/daemon` would follow a dependency's shrinkwrap only when the
# registry advertises one, and that is not something to stake every guest's
# tree on. A tarball packed on the Mac to try a change has none, because only
# the release resolves one, so its dependencies are resolved here instead and
# are not the reviewed tree.
$reviewed = Test-Path (Join-Path $install 'npm-shrinkwrap.json')
if (-not $reviewed) {
  if ($Version) { throw "$package@$Version has no npm-shrinkwrap.json; every release carries one." }
  Write-Warning "$Tarball has no npm-shrinkwrap.json, so its dependencies are resolved now, not installed from a reviewed tree."
}
$npmCommand = if ($reviewed) { 'ci' } else { 'install' }
Push-Location $install
try {
  & (Join-Path $nodeHome 'npm.cmd') $npmCommand --no-audit --no-fund
  if ($LASTEXITCODE) { throw "npm $npmCommand in $install exited $LASTEXITCODE." }
} finally {
  Pop-Location
}

# --------------------------------------------------------- the Provisioner

$provision = Join-Path $install 'provisioning\provision.ps1'
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $provision)
if ($HostUrl) { $arguments += @('-HostUrl', $HostUrl) }
& powershell.exe @arguments
exit $LASTEXITCODE
