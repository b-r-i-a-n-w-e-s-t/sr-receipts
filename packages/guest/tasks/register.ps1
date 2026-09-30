<#
.SYNOPSIS
  Register the rig's scheduled tasks, and open the daemon's ports.

.DESCRIPTION
  Every entry point into the rig has to reach the interactive console session.
  An SSH session has no interactive desktop, so NVDA has no foreground window to
  describe: it will start, accept a request, and record a transcript of nothing
  at all. That is what these tasks are for, and it is why the daemon, a network
  service in every other respect, is a logon-triggered interactive task rather
  than a Windows service.

  One task:

    nvda-daemon   the reader and a browser behind a port, at logon, so a booted
                  and signed-in guest is an appliance the Mac can use

  The Smoke is a client of that daemon (`npm run smoke`, from any shell), so
  it needs no task of its own.

    powershell -ExecutionPolicy Bypass -File tasks\register.ps1

  The daemon's bearer token is stored as a user environment variable so the
  logon task inherits it; it is generated if absent and printed, with the URL
  and browser endpoint to use from the Mac.

    -Firewall   open the daemon's two ports, so the Mac can reach them without
                Windows raising its own "Allow access?" dialog the first time
                node binds, which takes the foreground, and this rig has strong
                opinions about windows that take the foreground. Needs
                elevation; nothing else here does.

  The tasks themselves are registered to run *un*elevated on purpose: an
  elevated window holding the foreground is what makes browser activation
  fail, which is the trap docs/operating-the-rig.md opens with.

.PARAMETER Port
  The daemon's port. Default 8765. The browser server takes the next one.

.PARAMETER Token
  The bearer token the daemon requires. Generated and printed if omitted, and
  reused from the user environment if one was set before.

.PARAMETER Firewall
  Open both ports inbound. Needs an elevated session.
#>
[CmdletBinding()]
param(
  [int]$Port = 8765,
  [string]$Token,
  [switch]$Firewall
)

$ErrorActionPreference = 'Stop'

$rig = Split-Path -Parent $PSScriptRoot
# Asked of Windows rather than built from USERDOMAIN, which is empty over SSH
# and then fails with "No mapping between account names and security IDs".
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$browserPort = $Port + 1

Write-Host "Registering nvda-rig tasks from $rig as $user" -ForegroundColor Cyan

# ---------------------------------------------------------------- the token

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
[Environment]::SetEnvironmentVariable('RIG_BROWSER_PORT', "$browserPort", 'User')

# ----------------------------------------------------------------- the tasks

# Interactive: the whole point. Limited: deliberately not elevated, see above.
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
    New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
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

# The tasks the run layer had, before the pivot to `page`, and the smoke task
# from before the Smoke became a client of the daemon, are unregistered so a
# re-provisioned rig does not carry entry points that no longer exist.
foreach ($retired in 'nvda-run', 'nvda-probe', 'nvda-smoke') {
  if (Get-ScheduledTask -TaskName $retired -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $retired -Confirm:$false
    Write-Host "  $retired unregistered (retired)"
  }
}

Register-RigTask -Name 'nvda-daemon' -Script 'run-daemon.cmd' -AtLogon `
  -Description 'NVDA and a browser behind a port. Interactive by necessity: NVDA needs a desktop.'

# -------------------------------------------------------------- the firewall

if ($Firewall) {
  $rule = 'nvda-rig daemon'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port, $browserPort -Profile Any | Out-Null
  Write-Host "  firewall: TCP $Port and $browserPort open inbound"
}

# ------------------------------------------------------------------ the recap

# Nothing in the repo records how the Mac addresses the guest, because it
# depends on the UTM network mode. Print it rather than document it.
$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host ''
Write-Host 'From the Mac:'
foreach ($address in $addresses) {
  Write-Host "  RIG_URL=http://${address}:$Port"
  Write-Host "  RIG_BROWSER=ws://${address}:$browserPort/$Token"
}
Write-Host "  RIG_TOKEN=$Token"
Write-Host ''
Write-Host 'Start the daemon now without logging out:'
Write-Host '  Start-ScheduledTask nvda-daemon'
if (-not $Firewall) {
  Write-Host ''
  Write-Host "Re-run with -Firewall from an elevated PowerShell to open TCP $Port and $browserPort,"
  Write-Host 'so the Mac can reach them without Windows raising its own prompt when node binds.'
}
Write-Host ''
Write-Host 'Nothing here works from SSH. NVDA needs the console desktop: a locked'
Write-Host 'session is fine, a signed-out one is not.'
