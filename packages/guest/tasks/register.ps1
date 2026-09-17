<#
.SYNOPSIS
  Register the rig's scheduled tasks, and open the daemon's port.

.DESCRIPTION
  Every entry point into the rig has to reach the interactive console session.
  An SSH session has no interactive desktop, so NVDA has no foreground window to
  describe: it will start, accept a run, and record a transcript of nothing at
  all. That is what these tasks are for, and it is why the daemon — a network
  service in every other respect — is a logon-triggered interactive task rather
  than a Windows service.

  Until now the tasks existed only on this machine and only in the README's
  description of them. This is that knowledge, executable, so a fresh UTM image
  is one command from working.

  By default it registers the three on-demand tasks and touches nothing else:

    nvda-run      runs queue.txt
    nvda-probe    iterates on a key sequence
    nvda-smoke    one target, four steps

    powershell -ExecutionPolicy Bypass -File tasks\register.ps1

  The daemon is deliberately NOT one of them. Starting it by hand for a session
  of accessibility work — `npm run daemon` in packages\guest, from a terminal on the guest desktop
  — is the expected way to use it, and needs nothing registered. All a logon
  task buys is that the port comes back by itself after a reboot, which matters
  to CI and generally not to a person.

  Two switches, for when it does matter:

    -Firewall   open the port, so a hand-started daemon is reachable from the
                host. Needs elevation. Without it Windows raises its own
                "Allow access?" dialog the first time node binds — which takes
                the foreground, and this rig has strong opinions about windows
                that take the foreground.

    -Daemon     also register nvda-daemon at logon, and open the port. Implies
                -Firewall. This is the CI shape.

  Elevation is needed only for the firewall rule. The tasks themselves are
  registered to run *un*elevated on purpose: an elevated window holding the
  foreground is what makes `windowsActivate` fail, which is the trap this rig's
  README opens with.

.PARAMETER Port
  The daemon's port. Default 8765.

.PARAMETER Token
  The bearer token the daemon requires, stored as a user environment variable
  so the logon task inherits it. Generated and printed if omitted. Only used
  with -Daemon: a hand-started daemon generates its own and prints it.

.PARAMETER Daemon
  Also register nvda-daemon at logon. Implies -Firewall.

.PARAMETER Firewall
  Open the daemon's port without registering the logon task.
#>
[CmdletBinding()]
param(
  [int]$Port = 8765,
  [string]$Token,
  [switch]$Daemon,
  [switch]$Firewall
)

if ($Daemon) { $Firewall = $true }

$ErrorActionPreference = 'Stop'

$rig = Split-Path -Parent $PSScriptRoot
$user = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "Registering nvda-rig tasks from $rig as $user" -ForegroundColor Cyan

# ---------------------------------------------------------------- the token

# Only the logon task needs one set ahead of time. A hand-started daemon has a
# terminal to print a generated token to, so it makes its own.
if ($Daemon) {
  if (-not $Token) {
    $existing = [Environment]::GetEnvironmentVariable('RIG_TOKEN', 'User')
    if ($existing) {
      $Token = $existing
      Write-Host 'RIG_TOKEN: reusing the one already set for this user.'
    } else {
      $bytes = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $Token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('/', '_').Replace('+', '-')
      Write-Host 'RIG_TOKEN: generated a new one.'
    }
  }

  # A user environment variable rather than a file: the logon-triggered task
  # inherits the user's environment, so the daemon gets it without the token
  # having to sit in the repo where a commit could take it with it.
  [Environment]::SetEnvironmentVariable('RIG_TOKEN', $Token, 'User')
  [Environment]::SetEnvironmentVariable('RIG_PORT', "$Port", 'User')
}

# ----------------------------------------------------------------- the tasks

# Interactive: the whole point. Limited: deliberately not elevated — see above.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

function Register-RigTask {
  param(
    [string]$Name,
    [string]$Script,
    [switch]$AtLogon,
    [string]$Description
  )

  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$rig\$Script`"" -WorkingDirectory $rig

  $settings = if ($AtLogon) {
    # A daemon must not be killed after three days, and a second copy must not
    # be started on top of the one holding the port.
    New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  } else {
    # A run is minutes, but a queue of them is not; give it the day rather than
    # the default three, and refuse to start a second one over a live NVDA.
    New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit (New-TimeSpan -Hours 24) -MultipleInstances IgnoreNew
  }

  $task = if ($AtLogon) {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Trigger $trigger -Description $Description
  } else {
    New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Description $Description
  }

  Register-ScheduledTask -TaskName $Name -InputObject $task -Force | Out-Null
  Write-Host "  $Name -> $Script"
}

if ($Daemon) {
  Register-RigTask -Name 'nvda-daemon' -Script 'run-daemon.cmd' -AtLogon `
    -Description 'The rig behind a port. Interactive by necessity: NVDA needs a desktop.'
}
Register-RigTask -Name 'nvda-run' -Script 'run-queue.cmd' `
  -Description 'Run queue.txt.'
Register-RigTask -Name 'nvda-probe' -Script 'run-probe.cmd' `
  -Description 'Iterate on a key sequence against probe.json.'
Register-RigTask -Name 'nvda-smoke' -Script 'run-control.cmd' `
  -Description 'Does the rig work on this machine right now?'

# -------------------------------------------------------------- the firewall

if ($Firewall) {
  $rule = 'nvda-rig daemon'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
  Write-Host "  firewall: TCP $Port open inbound"
}

# ------------------------------------------------------------------ the recap

# Nothing in the repo records how the host addresses the guest, because it
# depends on the UTM network mode. Print it rather than document it.
$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green

if ($Daemon) {
  Write-Host ''
  Write-Host 'From the host:'
  foreach ($address in $addresses) { Write-Host "  RIG_URL=http://${address}:$Port" }
  Write-Host "  RIG_TOKEN=$Token"
  Write-Host ''
  Write-Host 'Start the daemon now without logging out:'
  Write-Host '  Start-ScheduledTask nvda-daemon'
} else {
  Write-Host ''
  Write-Host 'The daemon was not registered, which is the default. Start it by hand'
  Write-Host 'from a terminal on this desktop when you want to drive the rig from the'
  Write-Host 'host; it prints the URL and token to use:'
  Write-Host ''
  Write-Host "  cd $rig; npm run daemon"
  if (-not $Firewall) {
    Write-Host ''
    Write-Host "Re-run with -Firewall to open TCP $Port first, so the host can reach it"
    Write-Host 'without Windows raising its own prompt when node binds.'
  }
}

Write-Host ''
Write-Host 'Nothing here works from SSH. NVDA needs the console desktop: a locked'
Write-Host 'session is fine, a signed-out one is not.'
