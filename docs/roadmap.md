# Roadmap

Where sr-receipts is going, in order, and what is known but not yet decided.
Decisions with lasting consequences are recorded as ADRs in [`adr/`](adr/); this
file is the working list and changes as items land.

## Done so far

- **The NVDA rig.** A focus guard that proves the browser is in front, focus
  is in the document and browse mode is on, each by behaviour; the interactive
  scheduled-task mechanism; the Provisioner, which takes a manually installed
  Windows 11 ARM64 guest to a working rig in one command.
- **The rig behind a port.** An authenticated daemon on the guest.
- **VoiceOver on the Mac**, in process: the launch retry, hints off and
  stripped, the sentinel that tells silence from repetition, the doctor.
- **The investigations** that shaped all of it: where an expandable row's
  detail belongs, the docs page's iframe stealing focus, and
  carbon-svelte#382's typed-character echo.
- **The pivot to `page`** (2026-09-25, [ADR 0002](adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md)).
  A consuming repo writes ordinary Playwright specs against `page` and one
  `reader` fixture, with a `voiceover` and an `nvda` project, and runs both
  with one command. The guest daemon serves NVDA as routes and launches an
  Edge browser server; VoiceOver runs in process. The scenario language, the
  step runner, the verdict, the runner's snapshots and the Execution Target
  seam retired in favour of Playwright's own `expect`, attachments and
  snapshots. Proved before the refactor: 10 of 10 on NVDA, 5 of 5 on
  VoiceOver, 4 of 4 with both readers in one command. Proved after it, on
  2026-09-26, with both readers in one command: carbon-svelte's four specs
  (VoiceOver 4 of 4; NVDA passing the selection test and the
  `autoHighlight=none` control, and reproducing carbon-svelte#382 as two
  failures), and a scratch consumer outside both repositories, linked as the
  Playwright package's README says, whose passing and failing tests each
  carried a transcript and an environment stamp on both readers. The first
  VoiceOver run under the refactored session heard nothing after entry; the
  cause was the Control press after the sentinel, now removed (see
  `packages/voiceover/src/session.ts`).

- **A real issue, on both readers** (2026-09-29). carbon-svelte#393's specs
  found NVDA speaking a stray "dot" and a stale status, and both readers
  passed after the component changed. carbon-svelte's receipts config and
  specs stay in the maintainer's clone, out of that repository's history.
- **0.2.1 on npm and on both ends** (2026-10-05). carbon-svelte ran from
  the published packages, installed without saving: NVDA 3 of 3 plus
  carbon-svelte#382 reproducing on `/demo/96`, against the guest bootstrapped
  from npm; VoiceOver 4 of 4 on 0.2.0, whose VoiceOver package differs from
  0.2.1 only in its manifest.
- **0.2.0 on npm** (2026-10-05, [ADR 0003](adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md)).
  `@sr-receipts/host`, `voiceover`, `playwright` and `daemon`, public, from
  `node scripts/release.ts`. The daemon's tarball carries its
  `npm-shrinkwrap.json`: 51 packages, `undici` 8.11.2. npmjs.org advertises
  it (`_hasShrinkwrap: true`), which nothing depends on. npmjs.org took about
  three minutes to serve a new package after accepting it, behind a
  `0.0.0-stage` placeholder version, so the release now waits for each
  package before publishing the next.

- **Unreleased, for 0.3.0.** `reader.type`, typing at a set pace inside one
  speech window, at wire protocol 2, run on both readers. On VoiceOver it
  answers with the last phrase only. The fixture attaches the receipt when a
  reader never starts: on 2026-10-05 two VoiceOver tests failed with
  "VoiceOver cannot be started" and their reports showed only the error, not
  the five attempts behind it. The `sr-receipts` agent skill ships in
  `@sr-receipts/playwright`, installed with `npx skills`. VoiceOver types at
  the asked pace too: 150 ms asked, 151 to 164 ms between keys, 4 of 4.
- **The repository is `sr-receipts`, with CI** (2026-10-16). `npm test` runs
  on every push to `main` and every pull request, on Node 22 and 24, on a
  macOS runner: Guidepup throws on import on any platform with neither
  VoiceOver nor NVDA, so Linux fails every test file that imports it.

## Next, in order

1. **Go public, then release 0.3.0**:
   - **Make the repository public.** The packages' `repository` fields, their
     READMEs' links outside the package, and the skill point there, and
     404 for anyone else until it is.
   - **0.3.0**, then the guest Bootstrapped to it: wire protocol 2 means a
     0.3.0 host refuses a 0.2.x daemon, and the reverse. Proved when
     carbon-svelte passes on both readers from the published packages.
2. **Re-provision the rig** with the Bootstrap, on a fresh guest, and time it.
   Every developer will do this once; it is the product. The existing guest
   went through the Bootstrap on 2026-10-05 (see ADR 0003's consequences):
   0.2.0 fails at the Provisioner's Guidepup stage, 0.2.1 fixes it, and the
   guest is on 0.2.1 from npm with a healthy report. What is left is a guest
   that has never held a rig, and the timing. jsDelivr did not serve
   `provisioning/bootstrap.ps1` in the first minutes after 0.2.0's publish;
   the script was taken from the registry's tarball instead.
   On 2026-09-30 the existing guest turned out never to have been
   re-provisioned since the pivot: its `node_modules` dated from 2026-09-16
   and lacked `playwright-core` and the workspace links, it had the retired
   `nvda-run` and `nvda-probe` tasks and no `nvda-daemon`, the daemon had
   been started by hand, and Windows had added inbound Block rules for the
   rig's `node.exe`. It was repaired by hand with `npm ci`, `register.ps1`
   and `-Firewall`, as `docs/operating-the-rig.md` now describes. The
   Provisioner covers the first two but does not remove Block rules, which a
   fresh guest's first dismissed "Allow access?" dialog creates.
3. **A committed markdown receipt per failing test**, written by the fixture
   into the consuming repo, when a ticket needs a file rather than a report
   attachment. Deferred in ADR 0002 until a ticket asks.
4. **A second consuming app**: a TXST app other than carbon-svelte. This is
   what shows the setup cost to someone who did not build it.

## Research, after that

- **A VoiceOver twin of the detail-placement question** on the fixtures,
  now as specs: the first comparison of the two readers on one question.
- **A minimal reproduction of the `readTableColumnHeader` misfire** on
  VoiceOver, which sometimes answers with VoiceOver's startup greeting.
- **Guidepup's Virtual Screen Reader as a third project.** Its output is
  never a Receipt.

## Known, not yet decided

- **No mid-test focus watch.** The rig used to check `reportTitle` every few
  steps and stop when something stole the foreground. A test's `expect` now
  catches wrong speech, but a long reader-driven sequence can still type into
  a Windows Update dialog for a while first. Revive if a suite shows it.
- **Throughput.** One reader start per test (3.5 s on NVDA), an NVDA entry
  of about 28 s (12 s of it the focus-mode repair), a VoiceOver entry of 15 to
  25 s, a VoiceOver command of about 5 s with the sentinel. A session per
  worker and a faster VoiceOver capture are the candidates, once a suite
  shows where the time goes.
- **Edge only on the guest.** Playwright ships no Windows ARM64 browsers.
  NVDA plus Firefox evidence would need Playwright to change, or the guest to
  be x64.
- **Baselines.** Playwright's `toMatchSnapshot` on a transcript line is the
  intended mechanism; nothing uses it yet, and the environment stamp is an
  attachment rather than part of the snapshot.
- **The fixtures are static pages now.** The guest's `fixtures/` served the
  runner by `file:` URL; a spec has to serve them over `http` for the guest's
  browser to reach them. The Smoke still opens `control.html` by file URL on
  the guest, in the daemon's browser.
- **Upstream Guidepup issues** (the unbounded Item Chooser loop, the
  `readTableColumnHeader` misfire, the unconfigurable polling constants), each
  filed only after a minimal reproduction and approval at the time.
- **A stuck NVDA quit freezes the daemon.** Guidepup 0.34.0 runs
  `nvda.exe --quit` with `spawnSync` and no timeout, in both `start` and
  `stop` (`lib/windows/NVDA/quit.js`), so one quit that never returns blocks
  every route, `/health` included. It happened once, on 2026-09-30, mid-run,
  and the VM itself froze with it; why NVDA ignored the quit is not known.
  The candidate fix is for `NvdaDesktop` to end NVDA itself after a timeout
  rather than wait on Guidepup's quit. Also a Guidepup issue, under the same
  rule as the others.
- **The VoiceOver launch race is a window, not slowness.** Guidepup 0.34.0
  runs VoiceOverStarter, waits a fixed 500 ms and activates VoiceOver once.
  Measured on 2026-10-05 (macOS 26.6.2, build 25G83): activation asked 0,
  250, 1000 or 2000 ms after the starter was accepted 30 times in 30, and
  asked at 500 ms it was refused 4 times in 4 with `-600`, then accepted
  between 690 and 870 ms. Every retry, Guidepup's two and the session's
  five, repeats the same timing, so a run can lose all of them: carbon-svelte
  on the published 0.2.0 failed two VoiceOver tests of four this way, and
  twenty minutes later passed four of four with one start retried. The
  candidates are an upstream fix (retry the activation on `-600`), under the
  same rule as the other Guidepup issues, or the session launching VoiceOver
  itself. Why the window sits there is not known.
- **A possible upstream NVDA issue**: an ARIA combo box whose input carries
  `aria-activedescendant` loses typed-character echo under "Only in edit
  controls". Same rule as the Guidepup issues; the two
  `combobox-*activedescendant.html` fixtures are the minimal reproduction.
- **Reader settings per test.** Confirming carbon-svelte#382 needs NVDA's
  typed-character echo set to "Always", and a test has no way to ask for
  that. The daemon's `start` route could take settings.

## Alongside

- The VoiceOver Mac stays on macOS 26 until Guidepup ships a VoiceOver asset
  for macOS 27.
- Guidepup's launch race is tracked upstream as #113 (formerly #101).
