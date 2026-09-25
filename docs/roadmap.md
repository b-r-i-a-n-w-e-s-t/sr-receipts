# Roadmap

Where sr-receipts is going, in order, and what is known but not yet decided.
Decisions with lasting consequences are recorded as ADRs in [`adr/`](adr/); this
file is the working list and changes as items land.

## Done so far

- **The NVDA rig.** Scenarios as data the rig knows nothing about, a verdict
  that can fail a build, committed snapshots, a focus watch that stops a run
  when something steals the foreground, and per-scenario window sizes.
- **The rig behind a port.** An authenticated daemon on the guest that streams
  each run's progress, and a client on the Mac.
- **Provisioning.** `provision.ps1` takes a manually installed Windows 11 ARM64
  guest to a working rig in one command, and proves it with a real NVDA run.
- **Two packages and an Execution Target seam.** `@sr-receipts/host` and
  `@sr-receipts/guest`, with one run implementation behind
  `lib/execution-target.ts`.
- **VoiceOver as a second Execution Target**, with Safari on the Mac, and a
  committed baseline for a fixture and for a live page served over `http`.
- **The first investigation.** Where an expandable row's detail belongs in a
  table, measured on NVDA across seven fixtures.
- **Ready for a consumer.** Scenarios can be sent inline from the host, each
  request returns a Receipt, a run chooses whether to use the guest's
  snapshots at all, and the NVDA target's desktop is behind a seam that tests
  can fake.
- **A first Playwright slice on NVDA.** `@sr-receipts/playwright` and its
  `receipts` fixture, linked into `carbon-svelte` by `file:`, asking NVDA about
  `/demo/96` and reproducing carbon-svelte#382 in 75 to 88 seconds a test.
  What it changed in ADR 0001, and the timings it measured, are in the ADR.
- **Faster VoiceOver runs.** Where a VoiceOver step's time goes was measured,
  and turning VoiceOver's hints off cut a 20-step run by about 30%.

## Next, in order

The rig is built, and nothing outside this repository uses it yet. What comes
next is proving that other apps can: first by letting a consuming repo ask both
readers from its own Playwright tests, then by a second consumer. The
Playwright decisions, their costs, and what was deferred are in
[ADR 0001](adr/0001-playwright-is-the-runner-not-the-browser-driver.md).

Further work on the rig itself, including the items under "Known, not yet
decided", waits until a consumer shows which of them matter.

1. **The VoiceOver project in the same fixture**, running in-process on the Mac.
2. **Baselines for a consumer** through Playwright's `toMatchSnapshot`, so they
   live in the consuming repo.
3. **A second consuming app**: a TXST app other than carbon-svelte, with a
   handful of scenarios in its own repository. This is what shows sr-receipts
   is useful beyond the library it grew up with, and what its setup costs
   someone who did not build it.

## Research, after that

Questions worth answering, which a consumer does not need first.

- **A VoiceOver twin of `detail-placement`** on the same fixtures: the first
  comparison of the two readers on one question.
- **A minimal reproduction of the `readTableColumnHeader` misfire** on
  VoiceOver, which sometimes answers with VoiceOver's startup greeting.
- **A prototype of Guidepup's Virtual Screen Reader** as a third Playwright
  project, then a decision on whether it belongs. Whatever is decided, its
  output is never a Receipt and never compared with a real reader's baseline.

## Still to confirm on a real desktop

- VoiceOver with more than one target in a queue.

## Known, not yet decided

- **A failed window activation is not diagnosed.** When Guidepup's
  `windowsActivate` throws on the guest ("Unable to activate application"),
  the run breaks without the guard's `FOCUS FAILED` explanation.
- **Throughput.** Each reader runs one request at a time, and a VoiceOver step
  takes 5 to 7.5 seconds, so a broad suite takes an hour or more per reader. Two
  candidates, once a consumer's suite shows where the time goes: a reader
  session API (deferred in ADR 0001), and the VoiceOver target reading speech
  itself instead of through Guidepup's capture loop, whose fixed polling puts a
  floor of about 4.4 seconds under every step.
- **The VoiceOver baseline's recorded environment** predates hints being turned
  off, so comparisons against it report a changed environment until it is
  re-recorded.
- **Three smaller design improvements**: the VoiceOver smoke running through its
  Execution Target as the NVDA smoke now does, one entry point for reports, and
  cancelling an in-process run.
- **Upstream Guidepup issues** (the unbounded Item Chooser loop, the
  `readTableColumnHeader` misfire, the unconfigurable polling constants), each
  filed only after a minimal reproduction and approval at the time.

## Alongside

- The launch-race section of
  [`packages/guest/voiceover/README.md`](../packages/guest/voiceover/README.md)
  cites upstream issue #101, which has since been closed in favour of #113.
- The VoiceOver Mac stays on macOS 26 until Guidepup ships a VoiceOver asset for
  macOS 27.
