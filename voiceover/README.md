# Local VoiceOver execution-target smoke

This is a deliberately narrow, real-reader compatibility spike. It supports
only **macOS 26.6.x**, the **bundled VoiceOver**, **Safari 26.6.x**, English,
and **`@guidepup/guidepup` 0.34.0**. It does not replace the existing Windows
NVDA workflow.

## One-time human authorization

Do these actions manually, while signed in to the interactive Mac desktop:

1. Install this repository's pinned Node dependencies with `npm ci`.
2. Run `npx @guidepup/setup setup` and complete every Guidepup/macOS prompt.
   This is the step that creates Guidepup's local assets; it is intentionally
   not automated by this repository.
3. In **System Settings → Privacy & Security → Accessibility**, enable the
   terminal application that will run `npm run voiceover:smoke` (and approve
   any Guidepup helper that macOS presents).
4. In **System Settings → Privacy & Security → Automation**, allow that terminal
   and the Guidepup helper to control Safari if macOS asks.
5. Keep the system language list containing English and use the bundled
   VoiceOver. Do not run this smoke against a manually installed replacement.

The doctor and smoke never attempt to grant, reset, or bypass TCC permissions.
The smoke starts and stops VoiceOver, but deliberately leaves Safari open so it
does not close a maintainer's browser session.

## Run and inspect

```bash
npm run voiceover:doctor
npm run voiceover:smoke
```

The doctor is read-only. Passing it confirms only detectable versions and
assets; it cannot establish that macOS has authorized automation.

The smoke opens the committed local `fixture.html`, starts VoiceOver through
Guidepup, advances by heading until it hears the unique text
`Dogwalk VoiceOver smoke heading: Marigold Comet 48291`, and stops VoiceOver.
It writes an ignored, timestamped `voiceover-runs/<run-id>/` directory even if
startup, Safari control, navigation, capture, or cleanup fails:

- `environment.json` — pinned environment declaration and read-only checks
- `speech.json` — complete captured VoiceOver phrase log available at cleanup
- `result.json` — pass/fail, expected heading, error, and completion time

A successful result is the required proof that Guidepup controlled real
VoiceOver and captured speech from deterministic Safari content. A failure is
evidence of a remaining compatibility limitation, not permission for the
script to alter macOS state.
