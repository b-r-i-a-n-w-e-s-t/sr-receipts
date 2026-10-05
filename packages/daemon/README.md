# @sr-receipts/daemon

The Windows Guest Rig's half of sr-receipts: NVDA with headed Edge on the
guest's own interactive desktop, behind an authenticated port, and the record
of what it said. The Mac's half, [`@sr-receipts/host`](../host/README.md),
reaches this package's daemon. VoiceOver is not here: it runs in process on
the Mac, from [`@sr-receipts/voiceover`](../voiceover/README.md).

The guest gets this package from npm through the Bootstrap, never from a
checkout; see [`provisioning/README.md`](provisioning/README.md).

This README is about how the rig works and why. For the rest:

- what sr-receipts is for, and how a test flows through it:
  [the repository README](../../README.md)
- setting up, running and pointing tests at the Windows Guest Rig:
  [`docs/operating-the-rig.md`](../../docs/operating-the-rig.md)
- writing the tests: [`@sr-receipts/playwright`](../playwright/README.md)

On the guest, commands below run from the installed package,
`%LOCALAPPDATA%\nvda-rig\daemon`. In this repository, `npm test` here needs
`npm run build` at the root first, which the root's `npm test` does.

## Four things that are not obvious

These cost real time to discover. They are why this package exists, and why
Guidepup's own Playwright fixtures were not enough (ADR 0002).

1. **The daemon must run in the interactive session, not over SSH.** An SSH
   session has no interactive desktop, so NVDA has no foreground window to
   describe. `nvda-daemon` is a scheduled task registered with an interactive
   logon so it lands in the logged-in console session (see
   `tasks/register.ps1`); the Smoke is a client of it, so it needs no task. The same is why the browser's window can only
   be activated, and the desktop's windows only listed, by the daemon: a
   PowerShell over SSH sees no window titles at all.

2. **The browser has to be activated, and an elevated window blocks it.**
   SetForegroundWindow is refused from a background process unless it has
   just sent input, which is what the Alt press before it is for, and it
   cannot take the foreground from an elevated window at all. Alt+Esc was
   measured to cycle between other windows without ever reaching the
   browser. Edge has no window until a test connects, because Playwright
   starts Chromium-family browsers with no startup window.

3. **`F6` is the only recovery key.** Activation can leave focus on the
   browser's hidden menu bar: NVDA reports `menu` while the page reports
   `document.activeElement === body`, and the title still names the browser.
   `F6` cycles the browser's focus back into the content. `Escape` and a
   second activation were both measured and neither recovers. Every other
   key lands on the address bar, where a letter is typed as text.

4. **Browse-vs-focus mode cannot be queried, only asserted.** In focus mode
   every quick-navigation command is passed through to the page and answers
   with silence. `reportCurrentFocus` does not say which mode it is in (it
   appends an object-replacement character in focus mode, but that was
   measured to be unreliable). So the mode is proved behaviourally:
   quick-navigate, and toggle if the attempt is silent. Every NVDA run of
   the pivot's proof of concept was in focus mode after activation, and only
   this caught it.

## Layout

```
src/
  lib/
    nvda.ts       NVDA behind NvdaDesktop: Guidepup's actions one answer each,
                  the capture window, window listing and browser activation
    guard.ts      enterDocument(): points 2, 3 and 4, in order, proved; records
                  each step and throws when the proof fails, like any Entry
    daemon.ts     the reader behind a port: routing, auth, calls serialized
    stamp.ts      the Environment Stamp
    system.ts     delay, powershell, packageVersion
    smoke-result.ts  what the Smoke prints for the Provisioner
  daemon.ts       the daemon's entry point: NVDA behind a port, an Edge browser
                  server beside it
  smoke.ts        a client of the daemon: one fixture, the guards, four
                  commands, through the same ReaderSession a test has
  provisioning/   the health reporter the Provisioner runs
dist/             the build of src/, which is what runs on the guest
tasks/            register.ps1: the daemon's scheduled task, and the firewall rule
fixtures/         committed pages: control.html for the Smoke, and the pages
                  past investigations were measured on (only control.html is
                  published)
provisioning/     the Bootstrap, the idempotent Provisioner, and the Runtime
                  Manifest
run-daemon.cmd    what the scheduled task runs: the daemon, from the state
                  directory
test/             the parts that need no desktop
```

## The daemon's routes

Every request needs `Authorization: Bearer $RIG_TOKEN`, and the daemon refuses
to start without a token rather than falling back to open: anything that can
reach the port drives the guest's reader and browser. Calls on the reader
run one after another, in the order they arrived, because one desktop cannot
interleave two callers' keystrokes.

| | |
|---|---|
| `GET /health` | `{ ok, protocol, started, browser: { port, path }, rig }`, where `protocol` is the host's `PROTOCOL_VERSION` this daemon was built against, and `rig` is the environment stamp, taken once when the daemon starts. Not serialized, so it answers while a reader call is running. |
| `POST /reader/start` | Start NVDA. A reader that is already up is restarted, so a test that never stopped its reader cannot hold it for the next. |
| `POST /reader/stop` | |
| `POST /reader/enter` | `{ pageTitle, modeProbes? }`. The guards. `{ ok: true, arrivedOn, lines }`, or `{ ok: false, lines, error }` where `lines` is what the guards recorded, ending with the windows on screen, and `error` is the cause chain. |
| `POST /reader/perform` | `{ command }`, one of NVDA's commands by Guidepup's name. `{ spoken }`, `""` for silence. |
| `POST /reader/press` | `{ key }`, e.g. `"Control+Home"`. `{ spoken }` |
| `POST /reader/next`, `/reader/previous` | `{ spoken }` |
| `GET /reader/log`, `POST /reader/clear` | Guidepup's own log, which has one entry per action. |
| `POST /reader/capture/begin` | Open the speech window. Answers once Guidepup's listener is attached, so a page action sent next is inside it. |
| `POST /reader/capture/end` | Close it. `{ spoken }`: what was said inside it. |

The browser is not on these routes. The daemon launches a Playwright browser
server on the installed Edge at `ws://<guest>:8766/<token>`, and a test
reaches it with Playwright's own `connectOptions`. The token is the path:
Playwright's own protection for a browser server is a secret path, and this
keeps one secret rather than two.

## The Smoke

```
cd /d %LOCALAPPDATA%\nvda-rig
daemon\run-node.cmd daemon\dist\smoke.js
```

A client of the daemon, from any shell on the guest, SSH included. It starts
NVDA through the daemon's routes, opens `fixtures/control.html` in the
daemon's browser server, runs the guards and asks four commands through the
same `ReaderSession` a test on the Mac has, and stops. It asserts only that
the rig works: the daemon answered, the page was reached in browse mode, and
quick navigation spoke. Needs `RIG_TOKEN`, which `tasks/register.ps1` set for
the user. The Provisioner restarts the daemon and runs this as its proof.

## Tests

```bash
npm test
```

Everything that needs no desktop: the NVDA desktop against a fake Guidepup,
the guards against a fake desktop, the daemon against a fake desktop, the
host's NVDA session against the real daemon, the Provisioner's health report,
and the PowerShell scripts' shape.
