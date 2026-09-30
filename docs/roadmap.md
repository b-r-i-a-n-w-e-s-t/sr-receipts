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
  `packages/guest/voiceover/session.ts`).

## Next, in order

1. **carbon-svelte's receipts** on a real issue: reproduce it on both
   readers, try a fix, and cite the transcript in the ticket. On 2026-09-29,
   carbon-svelte#393 went through the first two: the specs found NVDA
   speaking a stray "dot" and a stale status, and both readers passed after
   the component changed. No transcript has been cited in a ticket yet. The
   consumer's config and specs are untracked in that repository and hidden by
   its `.git/info/exclude`; they run with `npx playwright test --config
   playwright.receipts.config.ts`, as its `package.json` has no script for
   them. Its lockfile still pins `@playwright/test` 1.62.1, with 1.63.0
   installed over it without saving; the client must share the guest's
   major.minor, so that is settled before any of it is committed. On
   2026-09-30, after the Reader Session was built once in the host for both
   readers, the specs passed on both readers (VoiceOver 4 of 4; NVDA 3 of 3
   plus carbon-svelte#382 reproducing on `/demo/96`), with the guest on the
   new daemon code. The `/demo/382` pages the other two echo specs need exist
   only in a carbon-svelte stash, so those specs were excluded.
2. **Re-provision the rig** with the Provisioner as it now is, on a fresh
   guest, and time it. Every developer will do this once; it is the product.
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
- **`undici` wants a newer Node than the guest pins.** `@guidepup/setup`
  0.25.3 pulls in `undici` 8.10.2, which requires Node 22.19 or later, and
  the Runtime Manifest pins 22.18.0. `npm ci` warns (`EBADENGINE`) and
  succeeds; the daemon does not load it, but the Provisioner's Guidepup setup
  stage does. Raise the pin, or hold `@guidepup/setup`, before the next
  provisioning run relies on it.
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
