# VoiceOver on a local Mac

The bundled VoiceOver, driven in process by the Playwright fixture, beside
whatever browser Playwright launched: its WebKit, or a branded Chrome, never
Safari. Deliberately narrow: **macOS 26.6.x**, the **bundled VoiceOver**,
English, and **`@guidepup/guidepup` 0.34.0**.

Two things live here: the doctor, a read-only check of the prerequisites, and
the mechanics the session in [`lib/voiceover.ts`](../lib/voiceover.ts) is
built from: the launch retry, the sentinel, the hints, and the permission
probe. A VoiceOver test needs the authorization below, and takes over the
Mac while it runs.

## One-time human authorization

Do these actions manually, while signed in to the interactive Mac desktop:

1. Install this repository's pinned Node dependencies with `npm ci` at the
   repository root. The commands below run from `packages/guest`.
2. Start the bundled VoiceOver once manually (Command-F5), complete Apple's
   first-run onboarding, then open **VoiceOver Utility → General** and enable
   **Allow VoiceOver to be controlled with AppleScript**. This establishes the
   local VoiceOver configuration without writing TCC's database.
3. In **System Settings → Privacy & Security → Accessibility**, enable the
   terminal application that will run `playwright test`. When macOS presents
   one, also approve the Guidepup helper used by this installation.
4. In **System Settings → Privacy & Security → Automation**, allow that terminal
   (and any presented Guidepup helper) to control **VoiceOver**, **System
   Events** and the browser Playwright launches (**Playwright** for its
   WebKit). These rows appear only after the relevant first request; rerun
   the test and answer the system prompt rather than editing TCC.
5. In **System Settings → Privacy & Security → Full Disk Access**, enable the
   same terminal application. It needs access to VoiceOver's protected group
   preference directory while Guidepup mounts its preference asset. If the
   terminal is an IDE-integrated terminal, grant the IDE application instead.
   Quit and reopen that application after changing Full Disk Access.
6. Keep the system language list containing English and use the bundled
   VoiceOver. Do not run this against a manually installed replacement.
7. Download the asset matched to this repository's Guidepup version:

   ```bash
   npx @guidepup/setup install voiceover
   ```

   This is the supported asset-install step, not the TCC-bypass `setup` step.
   It downloads the VoiceOver preference asset; rerun it after changing
   Guidepup. It is not a substitute for the manual permissions above.

Never run `@guidepup/setup setup` for VoiceOver: that setup flow can attempt
to write or bypass macOS's TCC database. Nothing here attempts to grant,
reset, or bypass TCC permissions.

**The grants follow the application that hosts the shell.** A `playwright
test` launched from an application without them fails at the start with an
EPERM on VoiceOver's group container, and the session refuses to start when
its permission probe finds Accessibility or Automation missing, because the
reader holds the keyboard once it is talking.

## The doctor

```bash
npm run voiceover:doctor
```

Read-only: platform, macOS version, the bundled VoiceOver, Guidepup and its
asset, access to VoiceOver's preferences, AppleScript control, and the
language. It writes `voiceover/doctor.json`. It cannot see Accessibility or
Automation; the session probes those itself, with a lone Control press,
before starting the reader.

## What a run does, and why

- **The launch is retried, on the launch race only.** Guidepup terminates and
  restarts VoiceOver inside `start()`, and can activate it before macOS has
  finished launching it: AppleScript `-600`, "application isn't running".
  Roughly one start in seven failed this way in the pivot's proof of concept.
  Five attempts with a ten second settle, every attempt in the transcript;
  anything else fails on the first attempt. See `orchestrator.ts`.
- **Web content is entered through the Item Chooser**, the sequence
  Guidepup's own fixture uses, with both loops bounded: ten attempts to open
  the chooser, five rounds of typing "web content". On macOS 26 the chooser
  usually speaks only its highlighted entry, "On item <name>", never the
  words "Item Chooser", so that phrase is matched. Arrival is the sequence
  returning and the first item having text.
- **A sentinel is spoken before every command.** Guidepup reads VoiceOver's
  `last phrase` and decides a command's speech is new by comparing it with
  the phrase it recorded last, which cannot tell silence from a repeat.
  Speaking "receipts mark" first makes `last phrase` something no page says:
  a silent command leaves it in place and is recorded as silence; a repeated
  announcement differs from it and is recorded whole. See `sentinel.ts`.
- **Hints are off and stripped.** `SCRShouldOutputVOInstructions: false`,
  found in VoiceOver's framework strings, not documentation. A hint arrives
  about a second after the announcement and restarts Guidepup's wait for
  speech to settle; with hints on, most steps took 8.5 to 15 seconds
  instead of 5 to 7.5. Any hint that gets through is cut from what is
  recorded, and a capture that was only a hint is silence. See `hints.ts`.
- **`capture(action)` is Guidepup's own**, with the sentinel spoken first.
  It caught a focus move that a 100 ms poll of `last phrase` had missed.

## What real runs have established

- The VoiceOver cursor **follows keyboard focus** that `page` moves
  (`locator.focus()`), 5 of 5, and one `next()` continues from there. It
  does **not** follow a click.
- A page-driven announcement (`1 row selected...`) is heard by `capture()`,
  9 of 9 across two runs, in about 5 seconds each.
- A Control press after the sentinel made VoiceOver drop the next
  announcement (2026-09-26, Playwright's WebKit): the first run of the
  refactored session recorded every page action and typed character as
  silence. The sentinel is now `output` alone. See `sentinel.ts`.
- `readTableColumnHeader` (VO-C) has answered with VoiceOver's own startup
  greeting in 3 of 11 uses, and once moved the cursor out of the table. The
  cause is unknown. Keep it out of anything whose later steps depend on
  where the cursor is.
- `moveToNext` does not stop at a row's last cell: it wraps to the first
  cell of the next row.
- An entry costs 15 to 25 seconds with whole-announcement capture, against
  9 to 12 with first-phrase capture.
