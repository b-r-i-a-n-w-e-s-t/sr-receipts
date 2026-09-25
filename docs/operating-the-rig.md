# Operating the Windows Guest Rig

The Windows Guest Rig is where NVDA runs: a Windows 11 ARM64 virtual machine
under UTM on a Mac, with NVDA and headed Firefox on its own interactive desktop.
This is the operator's guide to setting it up, running it, and driving it from
the Mac. Why the rig works the way it does is in
[`packages/guest/README.md`](../packages/guest/README.md); VoiceOver needs none
of this and is covered in
[`packages/guest/voiceover/README.md`](../packages/guest/voiceover/README.md).

Commands on the guest run from `packages\guest` in its checkout. Commands on
the Mac run from the repository root.

## The one rule behind all of it

**NVDA needs the interactive console desktop.** It describes whatever window is
in the foreground, so anything it runs must be started in the signed-in
desktop session. That is why:

- nothing runs over SSH, which has no desktop, and nothing runs as a Windows
  service;
- runs are started by scheduled tasks registered with an interactive logon, or
  from a terminal on the guest desktop;
- the daemon, which is reachable over the network, still runs on that desktop.

Keep the guest signed in and its desktop unlocked while you use it.

## First-time setup

1. **Create the virtual machine and finish Windows' own first run by hand.** The
   Provisioner starts after that point. The reviewed shape is 4 vCPUs, 8 GiB
   RAM, 64 GiB storage and UTM Shared (NAT) networking, on which the guest
   reaches the Mac at `192.168.64.1`.
2. **Clone this repository** into the signed-in user's own filesystem.
3. **Run the Provisioner** from `packages\guest`. It installs the pinned Node,
   Firefox, npm packages and NVDA asset, registers the scheduled tasks, and
   proves the result with a real NVDA run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1
   ```

   It is idempotent, so re-run it after changing anything it installs. The
   details, including what its health report checks, are in
   [`packages/guest/provisioning/README.md`](../packages/guest/provisioning/README.md).
4. **Decide how the daemon starts.** The Provisioner registers the three run
   tasks but not the daemon. Re-register with a switch if you want either:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tasks\register.ps1 -Firewall   # open the port for a hand-started daemon
   powershell -ExecutionPolicy Bypass -File tasks\register.ps1 -Daemon     # also start the daemon at logon (implies -Firewall)
   ```

   Both need an elevated PowerShell, for the firewall rule only. Without the
   rule, Windows raises its own "Allow access?" dialog the first time the
   daemon binds, and that dialog takes the foreground. `-Daemon` stores a
   bearer token as a user environment variable so the logon task inherits it,
   and prints the `RIG_URL` and `RIG_TOKEN` to use from the Mac.

## The scheduled tasks

| Task | Runs | Output |
|---|---|---|
| `nvda-smoke` | One fixture, four steps: does the rig work on this machine right now? | `artifacts\smoke-result.json`, `artifacts\smoke-log.txt` |
| `nvda-probe` | `probe.json` against the target named in `probe-fixture.txt`, for working out a key sequence | `probe-out.txt` |
| `nvda-run` | The queue in `queue.txt` | `runs\<runId>\` |
| `nvda-daemon` | The daemon, at logon. Only registered with `-Daemon`. | `artifacts\daemon.out` |

Start any of them from a PowerShell on the guest:

```powershell
Start-ScheduledTask nvda-smoke
```

`queue.txt` and `probe.json` are scratch and gitignored. Copy
`queue.example.txt` and `probe.example.json` to start; the example queue
documents its own format. `npm run smoke` and the like also exist, but only work
from a shell that is already on the interactive desktop, so the tasks are the
reliable path.

## Driving the rig from the Mac

This is the usual way to work: the app under test is served from the Mac, and
the question is asked from the Mac.

1. **Start the daemon on the guest.** Either run it by hand from a terminal on
   the guest desktop, which prints a URL and a generated token and holds the
   port until the window closes:

   ```powershell
   npm run daemon
   ```

   or, if it was registered with `-Daemon`, start the task:

   ```powershell
   Start-ScheduledTask nvda-daemon
   ```

2. **Put the URL and token in `.env.rig`** at the repository root on the Mac. It
   is gitignored. Never commit or paste the token: anything that can reach the
   port with it can run code in the guest, because a scenario reference is a
   path the guest imports.

   ```bash
   RIG_URL=http://<guest address>:8765
   RIG_TOKEN=<the token the daemon printed>
   ```

3. **Load it and check the daemon is up:**

   ```bash
   set -a; . ./.env.rig; set +a
   curl -s -H "Authorization: Bearer $RIG_TOKEN" "$RIG_URL/health"
   ```

   `/health` answers with whether a run is in flight and the guest's
   environment stamp.

4. **Run something**, from a script or a test, with `createClient` from
   `@sr-receipts/host`; see [`packages/host/README.md`](../packages/host/README.md).
   A target on the Mac's dev server is addressed as the guest sees it, for
   example `http://192.168.64.1:5173/docs/column-list`, and the dev server has
   to listen on that interface, not only on `localhost`.

What to know while it runs:

- **One run at a time.** A second request while one is in flight gets `409`
  naming the run in flight. It is not queued.
- **Hanging up does not cancel.** The run finishes and writes its files.
  `GET /runs/<runId>/events` replays what a disconnected client missed.
- **There is no route that lists runs.** A run id is the UTC time it started, to
  the second (`2026-09-23T185035`), carried by the first event of the stream and
in the report. Read a finished
  run's files with `GET /runs/<runId>/files/<name>`.

The daemon's routes are listed in
[`packages/guest/README.md`](../packages/guest/README.md#driving-the-rig-from-the-host).

## After pulling changes on the guest

The daemon loads the rig's code once, when it starts. After a `git pull` on the
guest:

1. Run `npm ci` at the repository root if `package-lock.json` changed.
2. Restart the daemon so it runs the new code. For the task:

   ```powershell
   Stop-ScheduledTask nvda-daemon; Start-ScheduledTask nvda-daemon
   ```

   For a hand-started daemon, close its window and start it again.
3. Re-run the Provisioner if `runtime-manifest.json` changed.

A guest provisioned before the rig moved from the repository root into
`packages/guest` needs the Provisioner re-run once from `packages\guest`, so
`npm ci` runs at the root and the tasks are re-registered at their new paths.

## Before a run

Three things on the guest desktop break runs, and each one looks like a
problem with the page if you do not know it:

- **An elevated window in the foreground.** An administrator PowerShell or VS
  Code in front makes Windows refuse Firefox the foreground, and the run fails
  to reach the page. Minimize elevated windows before starting a run. The tasks
  themselves run unelevated on purpose.
- **A pending Windows Update restart.** Its "Select a time to restart" dialog
  takes the foreground again and again. The target notices and stops the
  request with `FOCUS LOST`, naming the dialog, but every run will keep failing
  until the guest restarts. To check for one:

  ```powershell
  Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  ```

- **A shell that is not on the desktop.** A run started over SSH records
  nothing useful. Use the tasks or a terminal on the guest desktop.

## When a run goes wrong

| What you see | Likely cause |
|---|---|
| `FOCUS LOST after step N`, naming a window | Something took the foreground mid-run, most often a Windows Update dialog. See above. |
| The request never reaches the page, or `windowsActivate` fails with "Unable to activate application" | An elevated window is in front. Minimize it and run again. |
| `409` from the daemon | Another run is in flight. Wait for it; the response names it. |
| A snapshot differs and the environment stamp changed | Probably the browser or reader, not the page. Read the difference, then accept it with `--update-snapshots` if it is right. |
| Exit code 2 | The run broke rather than finding something. The transcript and `runs\<runId>\` say where. |
