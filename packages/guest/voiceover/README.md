# Local VoiceOver Execution Target

VoiceOver with Safari on a local Mac, deliberately narrow. It supports only
**macOS 26.6.x**, the **bundled VoiceOver**, **Safari 26.6.x**, English, and
**`@guidepup/guidepup` 0.34.0**. It sits beside the Windows NVDA workflow and
does not replace it.

Two things live here: the smoke, which proves on one fixed fixture that Guidepup
can drive and hear the real reader, and the mechanics of the
[Execution Target](../lib/voiceover-target.ts) that runs transcript scenarios.
Both need the authorization below.

## One-time human authorization

Do these actions manually, while signed in to the interactive Mac desktop:

1. Install this repository's pinned Node dependencies with `npm ci` at the
   repository root. The commands below run from `packages/guest`.
2. Start the bundled VoiceOver once manually (Command-F5), complete Apple's
   first-run onboarding, then open **VoiceOver Utility → General** and enable
   **Allow VoiceOver to be controlled with AppleScript**. This establishes the
   local VoiceOver configuration without writing TCC's database.
3. In **System Settings → Privacy & Security → Accessibility**, enable the
   terminal application that will run `npm run voiceover:smoke`. When macOS
   presents one, also approve the Guidepup helper used by this installation.
4. In **System Settings → Privacy & Security → Automation**, allow that terminal
   (and any presented Guidepup helper) to control **Safari** and **VoiceOver**.
   These rows appear only after the relevant first request; rerun the smoke and
   answer the system prompt rather than editing TCC.
5. In **System Settings → Privacy & Security → Full Disk Access**, enable the
   same terminal application. It needs access to VoiceOver's protected group
   preference directory while Guidepup mounts its preference asset. If the
   terminal is an IDE-integrated terminal, grant the IDE application instead.
   Quit and reopen that application after changing Full Disk Access.
6. Keep the system language list containing English and use the bundled
   VoiceOver. Do not run this smoke against a manually installed replacement.
7. Download the asset matched to this repository's Guidepup version:

   ```bash
   npx @guidepup/setup install voiceover
   ```

   This is the supported asset-install step, not the TCC-bypass `setup` step.
   It downloads the VoiceOver preference asset; rerun it after changing
   Guidepup. It is not a substitute for the manual permissions above.

Never run `@guidepup/setup setup` for this target: that setup flow can attempt
to write or bypass macOS's TCC database. The doctor and smoke never attempt to
grant, reset, or bypass TCC permissions.
The smoke starts and stops VoiceOver, but deliberately leaves Safari open so it
does not close a maintainer's browser session.

## Running scenarios

On macOS `runner.ts` drives VoiceOver, with the same queue, scenarios,
snapshots and `runs/<runId>/` artifacts as the NVDA rig:

```bash
node runner.ts "detail-v1-group-in-rowgroup.html :: voiceover-table-walk"
```

> [!WARNING]
> The target has completed real runs of `voiceover-table-walk` against one
> fixture, on 2026-09-19. What is not yet measured is how repeatable its
> snapshots are: that takes several runs of that scenario against one baseline.
> Until then, a snapshot difference on VoiceOver may be the capture's rather
> than the page's. Nothing has been run against an `http(s)` target, or with
> more than one target in a queue.

A scenario must say `reader: "voiceover"` and is written in VoiceOver's
commands, which are not NVDA's under other names. What the spike established:

- `findNextTable`, then `interactWithItem`, then `moveToNext` along a row and
  `moveDown` down a column, walks a web table cell by cell. Inside it,
  `readTableColumnHeader`, `readTableRowAndColumnNumbers` and `moveToNextColumn`
  answer as their names say.
- How the cursor arrived changes what VoiceOver moves by. `moveToPrevious` from
  the first cell left the table, and `moveToNext` from there walked the
  *contents* of cells rather than the cells. Write steps that do not back up.
- A step takes about 5 to 7.5 seconds. Guidepup decides an announcement is
  finished by reading VoiceOver's last phrase until it has not changed 25 times
  in a row, and each read is a 50 ms pause plus an AppleScript call of about
  125 ms, so no step is shorter than about 4.4 seconds. A new phrase also costs
  a pause Guidepup sizes from its word count at a fixed 7.5 words a second,
  whatever VoiceOver's speech rate. Those constants are not configurable, which
  is why raising the rate would not shorten a run. The 20-step table walk takes
  about three minutes, VoiceOver's start included.
- A step's announcement is one joined string, not one phrase per line as NVDA's
  is.
- VoiceOver's hints ("You are currently on a cell, inside of a table. To
  navigate…") are turned off, with `SCRShouldOutputVOInstructions: false` in
  the settings the target passes to Guidepup, and stripped from anything that
  gets through. A hint arrives about a second after the announcement, and
  whether Guidepup catches it is a race: two runs moved to the same cell by the
  same keys, and only one recorded the hint. A caught hint also restarts
  Guidepup's wait for speech to settle; on 2026-09-23, with hints on, 15 of 21
  steps took 8.5 to 15 seconds instead of 5 to 7.5, and turning them off cut
  the table walk from 4 min 25 s to 3 min 1 s. The key was found in VoiceOver's
  framework strings, not documentation; the first run with it off recorded no
  hint. Every transcript's environment block names the settings and says hints
  are stripped. A capture that was only a hint is recorded as silence, and page
  text that itself begins "You are currently on…" is cut from there. See
  [`hints.ts`](hints.ts).
- `readTableColumnHeader` (VO-C) has answered with VoiceOver's own startup
  greeting and "VoiceOver Settings activity" instead of the header in 3 of 11
  uses, and once moved the cursor out of the table. The cause is unknown. Keep
  it out of baselines, and out of any scenario whose later steps depend on
  where the cursor is.
- `moveToNext` does not stop at a row's last cell: it wraps to the first cell of
  the next row. Moving up past the first row leaves the table and announces it.
- Guidepup on its own cannot tell a silent command from a repeated
  announcement, because it reads VoiceOver's `last phrase` and compares it
  with the phrase it recorded last. Four runs recorded a key bound to nothing
  as the previous announcement again. So before every step the target has
  VoiceOver speak a sentinel phrase through its own `output` command and has
  Guidepup take note of it, then strips the sentinel from what is recorded.
  With it, that key is recorded as silence. See [`sentinel.ts`](sentinel.ts).
  The same sentinel is what lets an announcement identical to the previous
  step's survive: the phrase Guidepup compares against is now always the
  sentinel or nothing.
- VoiceOver answers a consecutive second press of a read command with the next
  level of detail, not the same words: VO-F3 (`describeItem`) with the item's
  description, VO-Shift-T (`readTableRowAndColumnNumbers`) with the table's
  dimensions. That looked like a capture fault until the sentinel ruled capture
  out. A scenario that wants the detail can ask twice on purpose. `voiceover-table-walk` exists to measure both. Until it has, prefer
  `expect` and `checks` to exact snapshots for anything that matters.

Before VoiceOver starts, the target runs the doctor's checks and then proves two
permissions the doctor cannot see, by sending Safari and System Events one
harmless Apple event each and pressing Control once. A first Apple event raises
a macOS consent prompt, and an unanswered prompt is indistinguishable from a
hung application; a terminal missing from Accessibility fails at the first
keystroke with System Events error 1002, after VoiceOver is already talking.
Stay at the keyboard until the first step prints, then leave it alone:
VoiceOver and Safari hold the foreground for the whole run, and the focus watch
stops the sequence if anything else takes it.

Each target opens in a Safari window of its own, which the run closes by id. It
never quits Safari or touches another window.

## Run and inspect the smoke

```bash
npm run voiceover:doctor
npm run voiceover:smoke
```

The doctor is read-only. Before smoke can start VoiceOver, it verifies the
version family, exact Guidepup package, matching VoiceOver asset, read/write
access to the protected VoiceOver preferences directory, and that VoiceOver's
AppleScript control is enabled. It cannot prove that macOS will authorize
automation.

The AppleScript-control check reads `SCREnableAppleScript` from
`~/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences/com.apple.VoiceOver4/default.plist`.
Sequoia moved these preferences into that group container, so `defaults` can no
longer read them. When the setting is off, Guidepup still starts, stops, and
sends keystrokes — those go through System Events, not VoiceOver — but every
message to VoiceOver's own scripting dictionary fails: property reads with
AppleScript `-1728` and commands with `-1708`. Capture therefore returns empty
strings while control looks perfectly healthy, which is why the doctor checks
it rather than leaving it to be diagnosed from a failed run. Enabling it is
step 2 of the manual authorization above; nothing here writes it, because the
preference lives in a protected group container.

> [!IMPORTANT]
> Enabling AppleScript control is not optional and not merely a permissions
> nicety: with it off, this target fails in a way that looks like a Guidepup
> bug. Control, startup, and keystrokes all appear healthy while capture
> silently returns empty strings.

The smoke opens the committed local `fixture.html`, starts VoiceOver through
Guidepup with phrase and cursor capture, then uses the documented public
Guidepup sequence that its Playwright adapter uses for web content: activate
Safari; cancel the current interaction; open **Item Chooser**; select
**Web Content**; and `interact()`. It deliberately does **not** use a web spot.
It advances by heading until both captured speech and the VoiceOver cursor
contain the normalized fixture token `MarigoldComet48291`, then stops VoiceOver.
Both streams must carry the token before navigation stops: the Item Chooser
speaks the name of the heading it is choosing, so speech alone can hold the
token while the cursor is still on the enclosing landmark.

Two details of this sequence are specific to macOS 26. The Item Chooser is
announced only as a generic VoiceOver menu — VoiceOver never speaks the words
"Item Chooser" — so the adapter matches that announcement instead of the
feature's name. And every wait in the sequence is bounded by an attempt count
that reports the phrase VoiceOver actually spoke, because a stage timeout alone
reports only elapsed time and hides why the sequence stalled.

It writes an ignored, timestamped `voiceover-runs/<run-id>/` directory even if
startup, Safari control, navigation, capture, or cleanup fails:

- `environment.json` — pinned environment declaration, read-only checks, failed
  stage, and every VoiceOver start attempt
- `speech.json` — complete captured VoiceOver phrase log available at cleanup
- `cursor.json` — VoiceOver cursor text observed after heading navigation
- `result.json` — pass/fail, original failed stage, cleanup outcomes, expected
  token, error, and completion time

A successful result is the required proof that Guidepup controlled real
VoiceOver and captured speech from deterministic Safari content. A failure is
evidence of a remaining compatibility limitation, not permission for the
script to alter macOS state.

## The VoiceOver launch race

Roughly one run in four used to fail at `start VoiceOver` with `VoiceOver cannot
be started` / `Application isn't running. (-600)` before any capture happened.
Guidepup terminates and restarts VoiceOver during `start()` and can activate it
before macOS has finished launching it; upstream issue
[#101](https://github.com/guidepup/guidepup/issues/101) reports related
not-fully-quitting behavior on Tahoe.

Startup now retries this, up to `START_ATTEMPTS` attempts, stopping the reader
between tries so a half-launched VoiceOver is not left behind and then waiting
`START_SETTLE_MS` before the next attempt. The limit went from three to five on
2026-09-19, when two runs in about ten reached the third attempt before the
reader came up.

**The delay is the part that works, not the retry.** Retrying immediately failed
all three attempts every time, while a fresh run seconds later always succeeded
— so the race needs macOS to finish tearing the reader down, not another
immediate attempt. With the settle delay, 8 of 8 consecutive runs passed, one of
them by recovering on its second attempt. Shortening or removing the delay
returns the whole retry to useless; measure before changing it.

Two further properties make the retry safe to trust:

- **Only this error is retried.** Anything else — a missing permission, a reader
  that cannot start at all — fails on the first attempt. A passing result still
  has to mean VoiceOver really was driven.
- **Every attempt is disclosed.** `environment.json` records `startAttempts`,
  including the successful one, so a run that needed a retry says so instead of
  passing silently. Watch that field: if retries become common, the race has
  changed and is worth reporting upstream rather than absorbing.

## Minimal capture probe

```bash
npm run voiceover:capture-probe
```

The probe is the smallest thing that exercises capture — no Safari, no fixture,
no Item Chooser, only start, one cursor move, and the capture queries. Use it
when the smoke reports empty speech, to separate a capture problem from a
navigation problem. It is what identified `SCREnableAppleScript` as the cause of
the `Can't get content of last phrase. (-1728)` failure.

It records every reading instead of throwing on the first failure, so one run
shows whether capture never worked or broke once the reader moved. Alongside
Guidepup's `lastSpokenPhrase()`, `spokenPhraseLog()`, and `itemText()`, it runs
the same AppleScript Guidepup runs plus `exists last phrase`. That matters
because Guidepup's client polls those scripts and discards their errors: only
the direct reading distinguishes a swallowed wrapper result from VoiceOver
exposing no `last phrase` object at all.

The probe prints one redacted JSON report to stdout, writes no artifacts, and
like the smoke it starts and stops VoiceOver — so it needs the same manual
authorization above. See
[`../research/guidepup-voiceover-capture-macos26.md`](../research/guidepup-voiceover-capture-macos26.md)
for what upstream Guidepup does and does not document about this failure.

> [!IMPORTANT]
> Guidepup 0.34.0 mounts the portable preference DMG, trusts its portable
> identifier, restarts the preferences daemon, and creates portable-preference
> symlinks. Its `stop()` implementation detaches the DMG and removes its shadow
> file, but does not remove those symlinks, untrust the identifier, or restart
> the preferences daemon. Run this only on a suitable local test desktop; it is
> not a read-only smoke test.
