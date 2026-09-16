# Local VoiceOver execution-target smoke

This is a deliberately narrow, real-reader compatibility spike. It supports
only **macOS 26.6.x**, the **bundled VoiceOver**, **Safari 26.6.x**, English,
and **`@guidepup/guidepup` 0.34.0**. It does not replace the existing Windows
NVDA workflow.

## One-time human authorization

Do these actions manually, while signed in to the interactive Mac desktop:

1. Install this repository's pinned Node dependencies with `npm ci`.
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

The smoke opens the committed local `fixture.html`, starts VoiceOver through
Guidepup with phrase and cursor capture, then uses the documented public
Guidepup sequence that its Playwright adapter uses for web content: activate
Safari; cancel the current interaction; open **Item Chooser**; select
**Web Content**; and `interact()`. It deliberately does **not** use a web spot.
It advances by heading until both captured speech and the VoiceOver cursor
contain the normalized fixture token `MarigoldComet48291`, then stops VoiceOver.
It writes an ignored, timestamped `voiceover-runs/<run-id>/` directory even if
startup, Safari control, navigation, capture, or cleanup fails:

- `environment.json` — pinned environment declaration and read-only checks
- `speech.json` — complete captured VoiceOver phrase log available at cleanup
- `cursor.json` — VoiceOver cursor text observed after heading navigation
- `result.json` — pass/fail, original failed stage, cleanup outcomes, expected
  token, error, and completion time

A successful result is the required proof that Guidepup controlled real
VoiceOver and captured speech from deterministic Safari content. A failure is
evidence of a remaining compatibility limitation, not permission for the
script to alter macOS state.

> [!IMPORTANT]
> Enabling AppleScript control is not optional and not merely a permissions
> nicety: with it off, this target fails in a way that looks like a Guidepup
> bug. Control, startup, and keystrokes all appear healthy while capture
> silently returns empty strings.

## Minimal capture probe

```bash
npm run voiceover:capture-probe
```

The probe is the smallest thing that exercises capture — no Safari, no fixture,
no Item Chooser, only start, one cursor move, and the capture queries. Use it
when the smoke reports empty speech, to separate a capture problem from a
navigation problem.

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
