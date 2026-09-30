# Changelog

All notable changes to `@sr-receipts/guest`. Pre-1.0: a minor version may break
the contract.

## Unreleased (0.2.0)

The pivot to `page`, [ADR 0002](../../docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).
Nearly everything here is breaking.

- **The daemon serves the reader, not runs.** `createRigServer({ token,
  desktop, browser })` routes `/reader/*` to an `NvdaDesktop`, serializes calls on it, restarts on `start`, and answers
  `/health` with `{ started, browser, rig }`. `POST /runs` and the run
  readout routes are gone. `daemon.ts` also launches a Playwright browser
  server on the installed Edge, at `ws://<guest>:8766/<token>`.
- **`lib/nvda.ts`** is NVDA behind `NvdaDesktop`: Guidepup's actions one
  answer each, the capture window as `captureBegin`/`captureEnd`, window
  listing and browser activation from inside the interactive session.
- **`lib/guard.ts`** is `enterDocument()`: the title guard with in-session
  activation, the document guard with F6, and the behavioural browse-mode
  proof, returning `{ ok, arrivedOn, lines }`. It replaces `session.ts`'s
  `openTarget` and `ensureReadyToNavigate`.
- **`lib/voiceover.ts`** is VoiceOver as a `ReaderSession`, in process, for
  the Playwright fixture: the adapter over `VoiceOverDesktop`.
- **`voiceover/desktop.ts`** is VoiceOver behind `VoiceOverDesktop`, the
  shape `NvdaDesktop` has: `createVoiceOverDesktop()` answers each of
  Guidepup's actions with what VoiceOver said, `""` for silence, with the
  sentinel spoken and stripped and hints stripped inside it. Its `start`
  runs the doctor's checks and the permission probe first, retries the
  launch race only, and records every attempt through the session's
  `Recorder`; `orchestrator.ts`, `launchWithRetry` and the `Outcome` type
  are gone. Its `chooser` is the Item Chooser's steps, without the sentinel.
- **`voiceover/entry.ts`** is `enterWebContent()`, VoiceOver's Entry: the
  bounded Item Chooser walk against whatever browser Playwright launched,
  tested on a fake desktop the way the Focus Guard is.
- **`GET /desktop/windows` and `POST /desktop/activate` are gone.** No
  session ever called them; the guards reach the desktop in process.
- **The sentinel is VoiceOver's `output` command alone.** The Control press
  that followed it made VoiceOver drop the next announcement.
- **The Environment Stamp names Edge and `playwright-core`** instead of
  Firefox.
- **`smoke.ts`** opens `fixtures/control.html` in Edge through
  `playwright-core`, runs the guards and four commands, and writes the same
  `SmokeResult` the Provisioner reads.
- **`tasks/register.ps1`** registers `nvda-daemon` at logon by default and
  `nvda-smoke`, asks Windows for the current identity (`USERDOMAIN` is empty
  over SSH), sets `RIG_BROWSER_PORT`, and `-Firewall` opens both ports.
- **The Provisioner** verifies Edge instead of installing Firefox, checks
  `playwright-core` beside Guidepup, and reads back `nvda-smoke` and
  `nvda-daemon`. `runtime-manifest.json` is schema 2.
- **Retired:** the scenario language and compiler, `steps.ts`, `expect.ts`,
  `snapshot.ts`, `report.ts`, `run.ts`, `target.ts`, `types.ts`, the
  Execution Target seam and both targets, `session.ts`, `speech.ts`,
  `firefox.ts` and the hermetic profile, `runner.ts`, `probe.ts`, the queue
  and probe files, the `nvda-run` and `nvda-probe` tasks, `scenarios/`,
  `snapshots/`, and VoiceOver's Safari driver, smoke and capture probe.
  `SILENCE` moved to `@sr-receipts/host`.
- `playwright-core` 1.63.0 is a dependency.
- **The VoiceOver session is an adapter** built with the host's
  `createReaderSession`, so its calls are now serialized, an unknown command
  rejects rather than throws, and a failed call or page action leaves a
  transcript line. A failed entry says "VoiceOver did not reach the page"
  and ends the transcript with the reason.
- **The Environment Stamp is taken once and kept**, asked of PowerShell in
  parallel. `NvdaDesktop.environment()` and `stamp()` return a promise, and
  `/health` no longer blocks the daemon with a synchronous PowerShell start
  per request.
- **Dead code removed:** `taskkill`, `validateModeProbes` (NVDA's `perform`
  already refuses an unknown command), and the smoke's `focusLost`, which was
  always null once the mid-test focus watch retired. `SmokeResult` is schema
  2, and the health report is schema 4 without its `focusRetained` check.
- One `powershell`, one `packageVersion`, and `errorChain` from the host,
  where the guest had two, three and two.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig. The NVDA runtime, daemon, Provisioner and VoiceOver smoke moved under
`packages/guest` unchanged in behaviour.
