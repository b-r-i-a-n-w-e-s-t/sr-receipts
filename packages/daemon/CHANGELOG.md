# Changelog

All notable changes to `@sr-receipts/daemon`, formerly `@sr-receipts/guest`.
Pre-1.0: a minor version may break the contract.

## Unreleased

- No changes; released with the other three packages.

## 0.3.0

- **`POST /reader/type`**, `{ text, delay? }`: types the text at a set pace
  inside one speech window and answers with everything said. The keys are
  sent by one PowerShell through `SendKeys`, so the gap between them is the
  delay and not Guidepup's wait for speech to end; the script carries
  character codes and never the text. A control character, a delay that is
  not a whole number from 0 to 10000, and typing inside an open capture are
  refused.
- **Built against wire protocol 2**, which `/health` reports.

## 0.2.1

- **Fixed: the Provisioner could not install the NVDA asset.** Guidepup's
  setup looks for `@guidepup/guidepup` from the directory it is run in, and
  the Provisioner works in the state directory, so its `guidepup-nvda` stage
  failed with "No local installation" and 0.2.0 could not provision a guest.
  The stage now runs Guidepup's setup from the package.

## 0.2.0

Packaged for npm with the other three packages, [ADR 0003](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md).

- **Ships built JavaScript and declarations** in `dist/`, because Node will
  not strip types under `node_modules`. MIT.
- **Breaking:** renamed from `@sr-receipts/guest`, and the VoiceOver
  session, its Entry, permission probe and doctor moved out to
  `@sr-receipts/voiceover`. `lib/index.ts` is gone: this package has no
  import interface, only its entry points.
- **The source moved under `src/`**, so the source and `dist/` sit at the
  same depth and `fixtures/` resolves from both.
- **The guest installs it from npm, not a checkout.**
  `provisioning/bootstrap.ps1` fetches an exact version (or takes a packed
  tarball), stops a running daemon, unpacks the package into
  `%LOCALAPPDATA%\nvda-rig\daemon`, installs the pinned Node and runs
  `npm ci` against the published `npm-shrinkwrap.json`, then runs the
  Provisioner. The Node install moved into `provisioning/node.ps1`, shared by
  both.
- **The rig's state moved out of the package**, to `%LOCALAPPDATA%\nvda-rig`:
  the daemon runs from there, and its log and pid file, the Smoke's
  transcript and the Provisioner's reports are written there.
- **The Provisioner no longer runs `npm ci`.** Its `packages` stage checks
  the Guidepup and `playwright-core` versions Node resolves from the
  package, and the Guidepup setup binary is resolved the same way.
- **`/health` reports `protocol`**, the host's `PROTOCOL_VERSION` the daemon
  was built against.
- **The guest's Node is 22.23.3**, up from 22.18.0. `undici`, which
  `@guidepup/setup` pulls in, requires 22.19 or later.

The pivot to `page`, [ADR 0002](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).
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
  proof. It has the shape every Entry has: it records each step through a
  `Recorder`, returns what the reader landed on, and throws with the reason
  after recording the windows on screen when the proof fails. The daemon's
  `/reader/enter` route is where that becomes the wire's `EntryResult`, so
  the guard knows nothing of the wire and the host's client parses no
  prose. It replaces `session.ts`'s `openTarget` and `ensureReadyToNavigate`.
- **`voiceover/session.ts`** is VoiceOver as a `ReaderSession`, in process,
  for the Playwright fixture: `createVoiceOverSession({ applicationName })`,
  one deep module. Guidepup's actions answer with what VoiceOver said, `""`
  for silence, with the sentinel spoken and stripped and hints stripped
  inside it (the former `sentinel.ts` and `hints.ts`, comments kept). Its
  `start` runs the doctor's checks and the permission probe first, retries
  the launch race only, and records every attempt; `orchestrator.ts`,
  `launchWithRetry` and the `Outcome` type are gone. The Item Chooser's
  steps are its implementation, without the sentinel. `VoiceOverDesktop`,
  `ItemChooser`, `createVoiceOverDesktop` and `lib/voiceover.ts` are gone
  with it; the tests fake Guidepup and ask through `ReaderSession`.
- **`voiceover/entry.ts`** is `enterWebContent()`, VoiceOver's Entry: the
  bounded Item Chooser walk against whatever browser Playwright launched,
  given the steps it sends (`EntrySteps`), tested on fake steps the way the
  Focus Guard is. `voiceover/evidence.ts` folded into `doctor.ts`.
- **`lib/index.ts` exports `createVoiceOverSession` and nothing else.** It
  is what the Mac imports; the daemon and the Smoke are this package's own
  entry points and import their modules directly.
- **`GET /desktop/windows` and `POST /desktop/activate` are gone.** No
  session ever called them; the guards reach the desktop in process.
- **The sentinel is VoiceOver's `output` command alone.** The Control press
  that followed it made VoiceOver drop the next announcement.
- **The Environment Stamp names Edge and `playwright-core`** instead of
  Firefox.
- **`smoke.ts` is a client of the daemon.** It starts NVDA through the
  daemon's routes, connects to the daemon's browser server, opens
  `fixtures/control.html`, runs the Focus Guard and four commands through
  the same `ReaderSession` a test on the Mac has, and stops. It runs from
  any shell on the guest, SSH included, with `RIG_TOKEN`; the desktop it
  proves is the daemon's. `runSmoke()` is its testable core. The transcript
  goes to `artifacts/smoke-transcript.txt` and the `SmokeResult` is the last
  line printed. `run-smoke.cmd`, `provisioning/run-smoke-task.ps1`, the
  `nvda-smoke` task and the smoke's request and artifact-path contract are
  gone.
- **`tasks/register.ps1`** registers `nvda-daemon` at logon, retires
  `nvda-smoke`, asks Windows for the current identity (`USERDOMAIN` is empty
  over SSH), sets `RIG_BROWSER_PORT`, and `-Firewall` opens both ports.
- **The Provisioner** verifies Edge instead of installing Firefox, checks
  `playwright-core` beside Guidepup, reads back `nvda-daemon`, and has a
  `daemon` stage that restarts the logon daemon and puts `RIG_TOKEN` in the
  reporter's environment, so the Smoke proves the daemon just provisioned.
  The health report is schema 5: its checks are an installed runtime, a
  daemon that answered, the Smoke's verdict, captured speech and a retained
  transcript. `runtime-manifest.json` is schema 2.
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
  always null once the mid-test focus watch retired. `SmokeResult` carries
  no schema version, and the health report is schema 5 without its
  `focusRetained` check.
- One `powershell`, one `packageVersion`, and `errorChain` from the host,
  where the guest had two, three and two.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig. The NVDA runtime, daemon, Provisioner and VoiceOver smoke moved under
`packages/guest` unchanged in behaviour.
