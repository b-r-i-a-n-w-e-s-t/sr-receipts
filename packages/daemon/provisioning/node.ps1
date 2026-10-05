<#
  The Runtime Manifest's pinned Node: where it lives, and installing it.

  Dot-sourced by provision.ps1, and by bootstrap.ps1, which needs Node before
  npm can install the daemon package and the Provisioner inside it. Kept in
  one file so the two cannot install different Nodes.
#>

# The rig's state outside the daemon package: Node, the daemon's log and pid
# file, the Smoke's transcript and the Provisioner's reports. A reinstall
# replaces the package directory, and Windows will not replace a directory a
# running process is standing in.
$RigState = Join-Path $env:LOCALAPPDATA 'nvda-rig'

function Get-RigNodeHome {
  param([Parameter(Mandatory)][pscustomobject]$Manifest)
  Join-Path $RigState "node-v$($Manifest.node.version)-win-arm64"
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

<#
  Install the pinned Node unless it is already there, and verify it. Returns
  what is now on disk; throws when that is not the pinned version.
#>
function Install-RigNode {
  param([Parameter(Mandatory)][pscustomobject]$Manifest)
  $nodeHome = Get-RigNodeHome $Manifest
  $node = Join-Path $nodeHome 'node.exe'
  $expected = "v$($Manifest.node.version)"
  if ((Get-NodeVersion $node) -ne $expected) {
    $download = Get-ExactFile $Manifest.node
    Write-Host "  installing Node $expected" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $RigState | Out-Null
    Expand-Archive -Path $download -DestinationPath $RigState -Force
  }
  $installed = Get-NodeVersion $node
  if ($installed -ne $expected) {
    throw "Node installation verification failed; expected $expected, found '$installed'."
  }
  "$installed at $nodeHome"
}
