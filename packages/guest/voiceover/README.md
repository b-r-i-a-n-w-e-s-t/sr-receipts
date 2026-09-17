# Local VoiceOver execution-target smoke

This is a deliberately narrow, real-reader compatibility spike. It supports
only **macOS 26.6.x**, the **bundled VoiceOver**, **Safari 26.6.x**, English,
and **`@guidepup/guidepup` 0.34.0**. It does not replace the existing Windows
NVDA workflow.

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

## Run and inspect

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
`START_SETTLE_MS` before the next attempt.

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
