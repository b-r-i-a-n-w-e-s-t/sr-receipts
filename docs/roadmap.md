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
  `packages/guest/voiceover/sentinel.ts`).

## Next, in order

1. **carbon-svelte's `npm run sr-testing`** on a real issue: reproduce it on
   both readers, try a fix, and cite the transcript in the ticket. The first
   consumer's config and specs are linked, uncommitted, in that repository,
   and run on both readers. Its lockfile still pins `@playwright/test`
   1.62.1, with 1.63.0 installed over it without saving; the client must
   share the guest's major.minor, so that is settled before it is committed.
2. **Re-provision the rig** with the Provisioner as it now is, on a fresh
   guest, and time it. Every developer will do this once; it is the product.
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
  browser to reach them. The smoke still opens `control.html` by file URL on
  the guest.
- **Upstream Guidepup issues** (the unbounded Item Chooser loop, the
  `readTableColumnHeader` misfire, the unconfigurable polling constants), each
  filed only after a minimal reproduction and approval at the time.
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
