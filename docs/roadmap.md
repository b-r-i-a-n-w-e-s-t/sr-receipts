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

- **0.3.0 on npm and on the guest** (2026-10-16). The repository went
  public first, so the packages' `repository` fields, their READMEs' links and
  the skill resolve for anyone. The guest is Bootstrapped to 0.3.0, which wire
  protocol 2 requires: a 0.3.0 host refuses a 0.2.x daemon, and the reverse.
  `reader.type`, typing at a set pace inside one
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
- **0.4.0 on npm: a Receipt File per test** (2026-10-22). The fixture
  writes `<spec>-receipts/<describe and test titles>--<project>.md` beside
  the spec for every test that ran a reader, replaced by each run and with no
  timestamp, so a change in what the reader said shows as a change to the
  file. `test.use({ receipt: { state } })` adds page state columns, and
  `capture(action, { label })` names a page action's Step. This was the
  committed markdown receipt ADR 0002 deferred; it was built without waiting
  for a ticket, because it replaced the skill's hand-copied recording
  template. Verified from the repository on both readers before the
  release, with two NVDA runs giving byte-identical files. The same release
  carries the Playwright minor preflight (see "The guest's Playwright pins
  the consumer's" below). The wire stays at protocol 2 and the daemon is
  unchanged, so the guest on 0.3.0 serves a 0.4.0 host without a Bootstrap.

- **0.5.0 on npm and on the guest: wire protocol 3** (2026-11-25). The NVDA
  desktop owns whether NVDA is up and the open Capture Window: a capture
  that Guidepup refuses no longer wedges the daemon, and a window a dead
  test left open is closed by the next start, with a Transcript line. The
  host's Reader Session refuses calls before start or after stop, on both
  readers. `/health` carries `playwright`, and the host's
  `checkGuestCompatibility` replaces the fixture's read of the stamp. Proved
  first from a tarball trial with the packed host unpacked over the one npm
  resolved: a capture begun with NVDA stopped answered "NVDA is not
  running" at once, twice; a window left open was closed by the next start
  and the next stop, each with its line; the Smoke passed; a Mac consumer on
  Playwright 1.63 passed an NVDA spec, and 1.64 stopped at the preflight
  with both fixes named. Then released, and the guest Bootstrapped to 0.5.0
  from npm, over SSH, with a healthy report and the shrinkwrap; the same
  spec passed on the published packages. A 0.4.0 Mac is refused by it.

## Next, in order

1. **Prove 0.5.0**: carbon-svelte passing on both readers from the
   published packages, against the guest. This replaces proving 0.4.0: a
   0.5.0 guest refuses a 0.4.0 Mac, and no run from the published 0.3.0 or
   0.4.0 packages is recorded. carbon-svelte's lockfile reached Playwright
   1.64 on 2026-10-21 while the guest holds 1.63, so its NVDA project stops
   at the preflight, now with both fixes named, until one of the two moves.
2. **Re-provision the rig** with the Bootstrap, on a fresh guest, and time it.
   Every developer will do this once; it is the product. The existing guest
   went through the Bootstrap on 2026-10-05 (see ADR 0003's consequences):
   0.2.0 fails at the Provisioner's Guidepup stage, 0.2.1 fixes it, and the
   guest was on 0.2.1 from npm with a healthy report, then on 0.3.0 by
   2026-10-20. What is left is a guest that has never held a rig, and the
   timing. jsDelivr did not serve
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
3. **An architecture review for a non-developer working through an agent.**
   The goal beyond the architecture is that an accessibility expert, not
   only a developer, runs sr-receipts with an agent such as Claude Code. A
   pass over what such a person meets: errors an agent can explain and
   recover from unaided, state that heals rather than needing a daemon
   restart (the NVDA quit hang is the known case), and what the skill tells
   the agent to do about each.
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

- **A trial that changes the host needs a hand step on the guest.** A
  daemon tarball resolves `@sr-receipts/host` from the registry, so the
  0.5.0 trial reported protocol 2 until the packed host was unpacked over
  `daemon\node_modules\@sr-receipts\host` and the daemon restarted. A
  trial path that carries the host would remove that step.
- **The Bootstrap works over SSH** while the user is signed in on the
  guest's console: 0.5.0 was installed that way on 2026-11-25 with a
  healthy report, though the Provisioner prints "Nothing here works from
  SSH". `docs/operating-the-rig.md` still says to run it from the desktop.
- **Architecture candidates not taken yet** (from the 2026-11-25 review).
  `type`'s rules live in each adapter and disagree: VoiceOver takes any
  whole delay, NVDA caps it at 10 000 ms and refuses after a round trip,
  and the control-character check is copied in both; the Reader Session
  could hold them once. `workers: 1` is a README rule, not a check: calls
  are serialized but sessions are not, so a second worker or a Smoke can
  restart NVDA under a running test. The fixture tests fake the whole Reader
  Session, so a Receipt File's Steps and Transcript are never checked
  against each other. VoiceOver's Entry is split across a seam with one real
  adapter.

- **No mid-test focus watch.** The rig used to check `reportTitle` every few
  steps and stop when something stole the foreground. A test's `expect` now
  catches wrong speech, but a long reader-driven sequence can still type into
  a Windows Update dialog for a while first. Revive if a suite shows it.
- **Throughput.** One reader start per test (3.5 s on NVDA), an NVDA entry
  of about 28 s (12 s of it the focus-mode repair), a VoiceOver entry of 15 to
  25 s, a VoiceOver command of about 5 s with the sentinel. A session per
  worker and a faster VoiceOver capture are the candidates, once a suite
  shows where the time goes.
- **The guest's Playwright pins the consumer's.** The NVDA project connects
  to the daemon's `launchServer`, and Playwright refuses a client of another
  major.minor, so a consumer's `npm up` that moves Playwright's minor stops
  NVDA until a daemon release on that minor. Found on 2026-10-21, when
  carbon-svelte's lockfile reached 1.64 and the guest held 1.63. The fixture
  now names the mismatch before connecting (0.4.0). Removing the daemon's pin
  would not help: the daemon is the server and holds one version either way.
  The candidate decoupling is `connectOverCDP` to the guest's Edge, which has
  no Playwright version check, behind a proxy that checks the token, since
  CDP has no authentication of its own; it would amend ADR 0002. The same
  change would take the token out of the endpoint's path, which Playwright
  prints in every connect error.
- **Edge only on the guest.** Playwright ships no Windows ARM64 browsers.
  NVDA plus Firefox evidence would need Playwright to change, or the guest to
  be x64.
- **Baselines.** A committed Receipt File is a baseline in practice: a
  change in what the reader said, or in the environment stamp in its header,
  shows in `git diff`. Nothing fails a run when a Receipt File changes;
  Playwright's `toMatchSnapshot` on a transcript line, or a check against the
  committed Receipt File, are the candidates once a consumer wants a run to
  fail on it.
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
