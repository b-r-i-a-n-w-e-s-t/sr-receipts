# sr-receipts

Receipts for what a screen reader actually said. sr-receipts runs a real screen
reader against a real web page, in the browser that reader's users actually
use, and records every word as evidence. Scenarios decide whether what it said
is right, committed baselines catch it when that changes, and each result says
exactly which reader, browser and operating system produced it.

## Why

Most accessibility testing inspects the page: axe reads the DOM, and a
simulated screen reader walks the accessibility tree and guesses what a reader
would say. Both are fast, and both miss the class of bug that only exists in
the reader. NVDA and VoiceOver each flatten, merge, skip and re-order what the
browser gives them, and they do it differently, and differently again from one
release to the next.

A **Receipt** is the answer to "what did the screen reader say?" from the
screen reader itself: the verdict, the full transcript, what was heard at each
step, and the environment that explains it. A simulated reader never produces
one.

That matters most for questions a DOM check cannot answer, such as:

- Does an expandable table row's detail announce as belonging to its row, or as
  a stranger in the table? Is it read once, or twice?
- When a row expands, does the table still announce the right number of rows?
  (The investigation this project began with found variants that said 21 rows
  for a table of 16.)
- Did a component library upgrade, or a browser upgrade, change how a widget is
  announced? And if it did, which of the two changed?

The first consumer is `@txstate-mws/carbon-svelte`, but nothing here knows about
it. Any web app that can be served over `http(s)` can be pointed at, and the
questions are scenarios a consuming repo can keep in its own tree.

## How it works

```
 The Mac you develop on                      Where a screen reader runs
 ─────────────────────                      ──────────────────────────

 your code / CI                              Windows Guest Rig (UTM VM)
   @sr-receipts/host  ── HTTP + token ──▶    guest daemon
   createClient()      ◀── NDJSON events ──    └─ NVDA + headed Firefox

 node runner.ts (on the Mac)  ──────────▶    VoiceOver + Safari, in-process
```

Three packages: two split by which side of the wire they live on, and a
Playwright fixture on the host's side:

| Package | Owns | Runs on |
|---|---|---|
| [`@sr-receipts/host`](packages/host/README.md) | Connecting to a guest daemon with a URL and bearer token, starting runs, reading back Receipts. Owns the wire protocol and knows nothing about any screen reader. | The Mac you develop on |
| [`@sr-receipts/guest`](packages/guest/README.md) | The daemon, scenarios, verdicts, snapshots, transcripts, every Execution Target, and the Provisioner for the Windows Guest Rig | The machine the screen reader runs on |
| [`@sr-receipts/playwright`](packages/playwright/README.md) | The `receipts` fixture, so a consuming repo asks a real reader from its own `playwright test`. Depends on the host. | The Mac you develop on |

The guest depends on the host for the protocol, never the other way round, so
nothing Mac-facing carries a screen reader's vocabulary. All three are private
workspace packages, versioned and changelogged separately, and not published.

An **Execution Target** is one screen reader with its browser on its own
desktop: NVDA with headed Firefox on a Windows 11 ARM64 virtual machine, or the
Mac's bundled VoiceOver with Safari. Each one sits behind the same seam
(`packages/guest/lib/execution-target.ts`), and one function, `executeRun` in
`packages/guest/lib/run.ts`, is the only run implementation. The command line
and the daemon are two thin callers of it, so a run started over HTTP and a run
started at the guest's keyboard write the same files and reach the same
verdict.

### The life of a request

A request is a **target** (a fixture file in the guest, or any `http(s)` URL)
and a **scenario** (what to ask it). One run carries one or more requests, one
at a time, because a screen reader owns the whole desktop.

1. **The scenario compiles** before the reader starts. A scenario is a name, a
   path, or the scenario object itself, sent inline from the host. Its steps
   are the reader's own commands (`perform: "moveToNextTable"` for NVDA,
   `perform: "findNextTable"` for VoiceOver) or key presses, so a typo fails in
   a second rather than after a three-minute run.
2. **The reader starts and the page opens** in a window of the run's own. Guards
   prove the keystrokes will reach the page: that the right window is in front,
   that the reader's cursor is in the web content, and on NVDA that browse mode
   is on. A guard that fails stops the request and says why, rather than
   recording silence that reads like a real answer.
3. **The steps run.** After each one the target records what the reader said,
   and re-checks every few steps that nothing has stolen the foreground.
4. **The run is judged** three ways: step expectations (what must be true of one
   announcement on any page), scenario checks (what must be true across the
   whole transcript, such as "announced once, not twice"), and the snapshot (the
   exact wording this target produced last time, committed).
5. **A Receipt comes back** for each request, and the run ends in one of three
   verdicts: **PASS** (exit 0), **FAIL** (exit 1: a finding about the page), or
   **broke** (exit 2: the question went unanswered). CI treats the last two
   differently on purpose.

Every transcript opens with an environment stamp: the exact operating system,
browser, reader, Guidepup and Node builds, plus a hash of the fixture's bytes.
When a snapshot differs, the stamp is how you tell a regression in the page from
a browser update that changed the wording.

## Using it

Four ways in today, all described in more detail elsewhere:

- **From the Mac, against NVDA.** Start the guest daemon, then call
  `createClient({ url, token }).run(requests)` from a script or a test. This is
  how a web app served from the Mac gets tested on NVDA: the guest reaches the
  Mac's dev server at its UTM network address.
- **On the Mac, against VoiceOver.** `node runner.ts "<target> :: <scenario>"`
  in `packages/guest` drives VoiceOver and Safari on the Mac itself. It needs
  a one-time set of macOS permissions, and it takes over the screen while it
  runs.
- **On the guest, against NVDA.** A queue file and the `nvda-run` scheduled
  task, for working inside the virtual machine.
- **From a consuming repo's Playwright tests, against NVDA.** The `receipts`
  fixture in `@sr-receipts/playwright`. Playwright is the runner and reporter
  only, never the browser driver, because it cannot drive Safari or release
  Firefox. See
  [ADR 0001](docs/adr/0001-playwright-is-the-runner-not-the-browser-driver.md).
  VoiceOver in the same fixture is next on the [roadmap](docs/roadmap.md).

## Where to read next

| To | Read |
|---|---|
| Write a scenario and decide what fails it | [`docs/scenarios.md`](docs/scenarios.md) |
| Set up and run the Windows Guest Rig, and drive it from the Mac | [`docs/operating-the-rig.md`](docs/operating-the-rig.md) |
| Run VoiceOver on a Mac, and what is known about capturing it | [`packages/guest/voiceover/README.md`](packages/guest/voiceover/README.md) |
| Understand the NVDA rig's internals and the daemon's routes | [`packages/guest/README.md`](packages/guest/README.md) |
| Call the daemon from code | [`packages/host/README.md`](packages/host/README.md) |
| Ask a reader from a consuming repo's Playwright tests | [`packages/playwright/README.md`](packages/playwright/README.md) |
| Provision a new Windows Guest Rig | [`packages/guest/provisioning/README.md`](packages/guest/provisioning/README.md) |
| See what is planned and why | [`docs/roadmap.md`](docs/roadmap.md), [`docs/adr/`](docs/adr/) |
| Look up a term | [`CONTEXT.md`](CONTEXT.md) |

## Working in the repository

```bash
npm ci      # at the repository root: installs every package from one lockfile
npm test    # every package's tests, then a typecheck of the whole repository
```

`npm test` needs no screen reader. Real-reader runs happen from
`packages/guest`.
