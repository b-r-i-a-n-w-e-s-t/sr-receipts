# Operating the Windows Guest Rig

The Windows Guest Rig is where NVDA runs: a Windows 11 ARM64 virtual machine
under UTM on your Mac, with NVDA and headed Edge on its own interactive
desktop. Each developer has one. This is the operator's guide to setting it
up, keeping it running, and pointing tests at it. Why the rig works the way it
does is in [`packages/daemon/README.md`](../packages/daemon/README.md);
VoiceOver needs none of this and is covered in
[`packages/voiceover/README.md`](../packages/voiceover/README.md).

The guest runs the published `@sr-receipts/daemon`, unpacked by the Bootstrap
into `%LOCALAPPDATA%\nvda-rig\daemon`. Everything the rig writes (the
daemon's log and pid file, the Smoke's transcript, the Provisioner's reports)
and the pinned Node live beside it in `%LOCALAPPDATA%\nvda-rig`. Commands on
the guest run from `%LOCALAPPDATA%\nvda-rig\daemon` unless they say
otherwise. Commands on the Mac run from the consuming repository.

## The one rule behind all of it

**NVDA needs the interactive console desktop.** It describes whatever window is
in the foreground, so anything it runs must be started in the signed-in
desktop session. That is why:

- nothing runs over SSH, which has no desktop, and nothing runs as a Windows
  service. Starting a scheduled task from SSH is fine, since the task runs in
  the desktop session, and so is anything that needs no desktop, such as
  `npm ci`;
- the daemon is a scheduled task registered with an interactive logon, started
  at logon, and reachable over the network anyway;
- the Smoke is a client of that daemon, so it runs from any shell, SSH
  included, and what it proves is the daemon's desktop.

Keep the guest signed in while you use it. A locked session is fine; a
signed-out one is not.

## First-time setup

1. **Create the virtual machine and finish Windows' own first run by hand.** The
   Provisioner starts after that point. The reviewed shape is 4 vCPUs, 8 GiB
   RAM, 64 GiB storage and UTM Shared (NAT) networking, on which the guest
   reaches the Mac at `192.168.64.1`.
2. **Run the Bootstrap** for the version the Mac's packages are on, from an
   unelevated PowerShell on the guest desktop. It fetches that version of
   `@sr-receipts/daemon`, checks it against the registry, unpacks it,
   installs the pinned Node and the package's dependencies from its
   shrinkwrap, and runs the Provisioner, which installs the NVDA asset,
   verifies Edge, registers the daemon at logon, restarts it, and proves it
   with a real NVDA run through its own routes:

   ```powershell
   $v = '0.2.1'
   Invoke-WebRequest "https://cdn.jsdelivr.net/npm/@sr-receipts/daemon@$v/provisioning/bootstrap.ps1" -OutFile bootstrap.ps1 -UseBasicParsing
   powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Version $v
   ```

   Both are idempotent. The Provisioner alone, after changing anything it
   installs, is `provisioning\provision.ps1` in the daemon directory. The
   details, including what its health report checks, are in
   [`packages/daemon/provisioning/README.md`](../packages/daemon/provisioning/README.md).
3. **Open the two ports**, once, from an elevated PowerShell in the daemon
   directory:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tasks\register.ps1 -Firewall
   ```

   Without the rule, Windows raises its own "Allow access?" dialog the first
   time the daemon binds, and that dialog takes the foreground. Registration
   prints the `RIG_URL`, `RIG_BROWSER` and `RIG_TOKEN` to use from the Mac.

   If that dialog was ever dismissed, Windows has already added inbound
   **Block** rules named `node.exe`, and a block rule beats this allow rule.
   Remove them first, from the same elevated PowerShell:

   ```powershell
   Get-NetFirewallRule -DisplayName node.exe | Where-Object Action -eq Block | Remove-NetFirewallRule
   ```
4. **Start the daemon now** without logging out, or sign out and in:

   ```powershell
   Start-ScheduledTask nvda-daemon
   ```

## Pointing tests at it

In the consuming repo, put the three values in a gitignored `.env.rig` and
load it before `playwright test`. Never commit or paste the token: anything
that can reach the ports with it drives the guest's reader and browser.

```bash
RIG_URL=http://<guest address>:8765
RIG_BROWSER=ws://<guest address>:8766/<token>
RIG_TOKEN=<the token>
```

Check the daemon is up:

```bash
set -a; . ./.env.rig; set +a
curl -s -H "Authorization: Bearer $RIG_TOKEN" "$RIG_URL/health"
```

`/health` answers with whether NVDA is up, where the browser server is, and
the guest's environment stamp. The `nvda` project's config then uses
`connectOptions: { wsEndpoint: RIG_BROWSER }` for `page` and
`readerOptions: { reader: 'nvda', url: RIG_URL, token: RIG_TOKEN }` for the
reader; see [`packages/playwright/README.md`](../packages/playwright/README.md).

**The dev server must listen on every interface.** The guest's browser
reaches the Mac at `192.168.64.1`, never `localhost`, so `vite dev --host
0.0.0.0` (or the framework's equivalent) is required, and the project's
`baseURL` is the Mac's address as the guest sees it. Check the listener with
`lsof -nP -iTCP:<port> -sTCP:LISTEN` and make sure it is exactly one process:
two dev servers on one port, one on IPv6 loopback and one on all interfaces,
once served different code to the Mac and to the guest.

**Playwright versions must match.** A Playwright client connects only to a
browser server of the same major.minor. The guest's `playwright-core` is
pinned in the Runtime Manifest; the consumer's `@playwright/test` has to
match it.

**The wire's protocol versions must match.** The daemon reports the protocol
version it was built against in `/health`, and the Mac's NVDA session refuses
any other at start, naming both. Any two releases with the same protocol work
together; when they differ, upgrade whichever side is older.

## The scheduled tasks

| Task | Runs | Output |
|---|---|---|
| `nvda-daemon` | The daemon, at logon: NVDA behind a port, and an Edge browser server beside it. | `%LOCALAPPDATA%\nvda-rig\artifacts\daemon.out` |

Start it from a PowerShell on the guest, or from SSH:

```powershell
Start-ScheduledTask nvda-daemon
```

The task runs `run-daemon.cmd` from the daemon directory, which runs the
daemon from the state directory, so a reinstall can replace the package.

## The Smoke

```
cd /d %LOCALAPPDATA%\nvda-rig
daemon\run-node.cmd daemon\dist\smoke.js
```

A client of the daemon, from any shell on the guest, SSH included: it starts
NVDA through the daemon's routes, opens `fixtures/control.html` in the
daemon's browser server, runs the Focus Guard and four commands through the
same `ReaderSession` a test on the Mac has, and stops. It needs `RIG_TOKEN`,
which `tasks\register.ps1` set for the user. The transcript is written to
`artifacts\smoke-transcript.txt` in the directory it is run from, and the
last line printed is its result as JSON. A daemon started over SSH answers every route and hears nothing, so the
Smoke failing on its guard is the posture check.

## Upgrading the guest

The daemon loads its code once, when it starts. To move the guest to another
release, run the Bootstrap again, from the guest desktop, with that version
(see first-time setup). It stops the daemon, replaces the package whole,
installs its Node and dependencies, re-registers the task, restarts the
daemon, and proves it with the Smoke. It does not touch the firewall.

To try a change before it is published, pack the daemon on the Mac and give
the Bootstrap the tarball instead of a version. Only a release carries a
shrinkwrap, so the Bootstrap resolves the tarball's dependencies as it
installs them, and warns that they are not the reviewed tree. They still
come from the registry, so a change that also needs an unpublished host has
to be published first:

```bash
npm run build && (cd packages/daemon && npm pack)   # on the Mac
```

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Tarball sr-receipts-daemon-0.2.1.tgz
```

**A guest still running from a git checkout** of this repository moves over
with one Bootstrap run. The Provisioner re-registers `nvda-daemon` against
the installed package and retires older tasks, the stored `RIG_TOKEN` is
reused, so the Mac's `.env.rig` stays as it is, and the checkout can then be
deleted.

To restart the daemon without upgrading, pause between the two commands.
Ending a task is asynchronous, and ending and starting back to back has let
the termination land on the freshly started instance:

```powershell
Stop-ScheduledTask nvda-daemon; Start-Sleep 3; Start-ScheduledTask nvda-daemon
```

Task Scheduler ends only the task's own `cmd.exe`; the daemon's node process
would survive and keep the ports. So the daemon records its PID in
`artifacts\daemon.pid` under the state directory, and `run-daemon.cmd` ends
that process before starting the next one, as the Bootstrap does before an
upgrade. A daemon that will not come back is diagnosed with
`netstat -ano | findstr :8765` and `artifacts\daemon.out`.

## Before a run

Three things on the guest desktop break runs, and each one looks like a
problem with the page if you do not know it:

- **An elevated window in the foreground.** An administrator PowerShell or VS
  Code in front makes Windows refuse Edge the foreground, and the entry fails
  its title guard, naming every window on the desktop. Minimize elevated
  windows before starting a run. The tasks themselves run unelevated on
  purpose.
- **A pending Windows Update restart.** Its "Select a time to restart" dialog
  takes the foreground again and again. The entry fails, naming it, but every
  run will keep failing until the guest restarts. To check for one:

  ```powershell
  Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  ```

- **A shell that is not on the desktop.** A daemon started over SSH records
  nothing useful. Use the tasks or a terminal on the guest desktop.

## When a run goes wrong

| What you see | Likely cause |
|---|---|
| `FOCUS GUARD FAILED: the browser is not in front`, with a window list | Something elevated is in front, or Edge has no window yet. Minimize elevated windows and run again. |
| `focus never reached the document` | Focus stuck outside the content; F6 did not recover it. Look at the window list in the same message. |
| `browse mode could not be proved` | The page has no table, heading or landmark for the default probes; pass `modeProbes` to `enter`. |
| `the guest daemon ... is not reachable` | The VM is not booted or signed in, the daemon task is not running, or the ports are closed. |
| `/health` answers 403, `token not accepted` | The consumer's token is stale: `register.ps1` generates a new one when none is stored for the user. Read the stored one on the guest with `[Environment]::GetEnvironmentVariable('RIG_TOKEN','User')`, and update both `RIG_TOKEN` and `RIG_BROWSER` in `.env.rig`, since the browser endpoint's path is the token. |
| The daemon's ports are `LISTENING` in `netstat` on the guest, but closed from the Mac | Inbound Block rules named `node.exe`, left by a dismissed "Allow access?" dialog. See step 3 of first-time setup. |
| `artifacts\daemon.out` ends with `ERR_MODULE_NOT_FOUND` | The daemon's dependencies are missing or partial. Run the Bootstrap again for the same version; see "Upgrading the guest". |
| `the guest daemon ... speaks wire protocol N, and this host speaks M` | The Mac's packages and the guest's daemon are from releases with different wire protocols. Upgrade the older side: the Bootstrap on the guest, npm on the Mac. A daemon from before protocol versions reports `none`. |
| `Test timeout ... while setting up "reader"`, then `fetch failed` with `HeadersTimeoutError` about five minutes in, and `/health` never answers although the ports accept connections | NVDA did not quit. Guidepup runs `nvda.exe --quit` synchronously with no timeout, in both start and stop, so one stuck quit freezes every route. Confirm over SSH: the daemon's node process has a `cmd.exe` child running `nvda.exe --quit`. End NVDA and that `cmd.exe`, then restart the daemon task. On 2026-09-30 the whole VM froze with it and had to be restarted. |
| `connect` fails with a version message | The consumer's `@playwright/test` and the guest's `playwright-core` differ in major.minor. |
| The transcript has plausible silences | Read the entry lines at its top first: they are the only uncontaminated measurement of where the reader was. |
