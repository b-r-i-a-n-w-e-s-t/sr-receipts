# Operating the Windows Guest Rig

The Windows Guest Rig is where NVDA runs: a Windows 11 ARM64 virtual machine
under UTM on your Mac, with NVDA and headed Edge on its own interactive
desktop. Each developer has one. This is the operator's guide to setting it
up, keeping it running, and pointing tests at it. Why the rig works the way it
does is in [`packages/guest/README.md`](../packages/guest/README.md);
VoiceOver needs none of this and is covered in
[`packages/guest/voiceover/README.md`](../packages/guest/voiceover/README.md).

Commands on the guest run from `packages\guest` in its checkout. Commands on
the Mac run from the consuming repository.

## The one rule behind all of it

**NVDA needs the interactive console desktop.** It describes whatever window is
in the foreground, so anything it runs must be started in the signed-in
desktop session. That is why:

- nothing runs over SSH, which has no desktop, and nothing runs as a Windows
  service;
- the daemon is a scheduled task registered with an interactive logon, started
  at logon, and reachable over the network anyway;
- the smoke is a scheduled task too.

Keep the guest signed in while you use it. A locked session is fine; a
signed-out one is not.

## First-time setup

1. **Create the virtual machine and finish Windows' own first run by hand.** The
   Provisioner starts after that point. The reviewed shape is 4 vCPUs, 8 GiB
   RAM, 64 GiB storage and UTM Shared (NAT) networking, on which the guest
   reaches the Mac at `192.168.64.1`.
2. **Clone this repository** into the signed-in user's own filesystem.
3. **Run the Provisioner** from `packages\guest`. It installs the pinned Node,
   npm packages and NVDA asset, verifies Edge, registers the daemon at logon
   and the smoke task, and proves the result with a real NVDA run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1
   ```

   It is idempotent, so re-run it after changing anything it installs. The
   details, including what its health report checks, are in
   [`packages/guest/provisioning/README.md`](../packages/guest/provisioning/README.md).
4. **Open the two ports**, once, from an elevated PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tasks\register.ps1 -Firewall
   ```

   Without the rule, Windows raises its own "Allow access?" dialog the first
   time the daemon binds, and that dialog takes the foreground. Registration
   prints the `RIG_URL`, `RIG_BROWSER` and `RIG_TOKEN` to use from the Mac.
5. **Start the daemon now** without logging out, or sign out and in:

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

## The scheduled tasks

| Task | Runs | Output |
|---|---|---|
| `nvda-daemon` | The daemon, at logon: NVDA behind a port, and an Edge browser server beside it. | `artifacts\daemon.out` |
| `nvda-smoke` | One fixture, the guards, four commands: does the rig work on this machine right now? | `artifacts\smoke-result.json`, `artifacts\smoke-log.txt` |

Start either from a PowerShell on the guest:

```powershell
Start-ScheduledTask nvda-smoke
```

`npm run daemon` and `npm run smoke` also exist, but only work from a shell
that is already on the interactive desktop, so the tasks are the reliable
path.

## After pulling changes on the guest

The daemon loads the rig's code once, when it starts. After a `git pull` on
the guest:

1. Run `npm ci` at the repository root if `package-lock.json` changed.
2. Restart the daemon so it runs the new code, with a pause between the two
   commands. Ending a task is asynchronous, and ending and starting back to
   back has let the termination land on the freshly started instance:

   ```powershell
   Stop-ScheduledTask nvda-daemon; Start-Sleep 3; Start-ScheduledTask nvda-daemon
   ```

   Task Scheduler ends only the task's own `cmd.exe`; the daemon's node
   process would survive and keep the ports. So the daemon records its PID in
   `artifacts\daemon.pid`, and `run-daemon.cmd` ends that process before
   starting the next one. A daemon that will not come back is diagnosed with
   `netstat -ano | findstr :8765` and `artifacts\daemon.out`.

3. Re-run the Provisioner if `runtime-manifest.json` changed.

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
| `connect` fails with a version message | The consumer's `@playwright/test` and the guest's `playwright-core` differ in major.minor. |
| The transcript has plausible silences | Read the entry lines at its top first: they are the only uncontaminated measurement of where the reader was. |
