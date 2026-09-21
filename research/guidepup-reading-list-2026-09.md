# Guidepup reading list for Playwright integration (2026-09)

Research date: 2026-09-21. Upstream state inspected at these commits and package versions:

| Source | State inspected |
| --- | --- |
| `@guidepup/guidepup` | npm `0.34.0` (published 2026-08-31); repo `main` at [`2573d62`](https://github.com/guidepup/guidepup/commit/2573d62f73df50ce13c12d91d6ac57311fab9553) (2026-09-20) |
| `@guidepup/playwright` | npm `0.19.1` (published 2026-08-16); repo `main` at [`897b0ff`](https://github.com/guidepup/guidepup-playwright/commit/897b0ff72441153773dae1859798225375cbbd21) (2026-08-16) |
| `@guidepup/setup` | npm `0.25.3` (published 2026-09-08); repo `main` at [`5b5a1db`](https://github.com/guidepup/setup/commit/5b5a1db208fbc286a2210fbf1c97fdd26df2078e) (2026-09-13) |
| `@guidepup/virtual-screen-reader` | npm `0.33.0` (published 2026-09-20); repo `main` at [`06d4294`](https://github.com/guidepup/virtual-screen-reader/commit/06d4294e8f92641f088d4e027ef62401e02c0754) |
| `@guidepup/jest` | npm `0.5.2` (published 2024-09-14) |
| Docs site | [guidepup/guidepup.dev](https://github.com/guidepup/guidepup.dev) `main` at `80263c7` (2026-09-11), read as Markdown source, plus the rendered pages cited below |

Versions were read with `npm view <package> version time.modified peerDependencies dependencies` and from each repository's `package.json`. Statements below are marked **Verified** (read directly in the cited source) or **Inference** (my reasoning from verified facts). This note extends, and does not repeat, [`guidepup-playwright-dogwalk.md`](guidepup-playwright-dogwalk.md) and [`guidepup-voiceover-capture-macos26.md`](guidepup-voiceover-capture-macos26.md).

## Executive finding

1. **Nothing upstream has moved the boundary.** `@guidepup/playwright` is still an in-process Playwright Test fixture around the local `nvda` and `voiceOver` singletons. There is still no remote transport. The upstream "remote control" idea is an open issue from 2024 with no comments and no code ([guidepup#76](https://github.com/guidepup/guidepup/issues/76)). The dogwalk recommendation stands.
2. **New, and the most roadmap-relevant fact: the adapter cannot test the browsers sr-receipts tests today.** Its application map sends `webkit` to the app named `Playwright` (Playwright's own WebKit build) and `firefox` to `Nightly` (Playwright's patched Firefox). Playwright states it does not work with branded Safari or branded Firefox. sr-receipts currently drives real Safari.app and real release Firefox. Adopting `voiceOverTest` or `nvdaTest` as shipped therefore changes the browser under test and invalidates the existing baselines. The earlier research did not surface this.
3. **Versions are unchanged since the dogwalk research** (`@guidepup/playwright` 0.19.1, peer `@playwright/test ^1.57.0`, peer `@guidepup/guidepup >=0.33.0`; `@guidepup/guidepup` 0.34.0 is both pinned and latest). What is new is unreleased work on `main`, new issues (macOS 27, SIP-enabled Tahoe setup), and facts the earlier pass did not read (fixture scope, application map, polling behaviour of `capture: "initial"`, what `start()` does to the machine).

## 1. What changed since the dogwalk research

| Item | Earlier research | Now | Changed? |
| --- | --- | --- | --- |
| `@guidepup/playwright` version | 0.19.1 | 0.19.1, no commits to `src/` since 2026-08-16 ([commits](https://github.com/guidepup/guidepup-playwright/commits/main)) | No |
| Peer `@playwright/test` | `^1.57.0` | `^1.57.0` ([`package.json`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/package.json)); dev dependency is `^1.60.0` | No |
| Peer `@guidepup/guidepup` | `>=0.33.0` | `>=0.33.0` (a peer, not a dependency; the adapter has no runtime `dependencies`) | No |
| Adapter exports | `screenReaderConfig`, `screenReaderTest`, `voiceOverTest`, `nvdaTest` plus types | Same ([`src/index.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/index.ts#L1-L7)) | No |
| `@guidepup/guidepup` latest | 0.34.0 | 0.34.0 on npm. `main` has one unreleased feature commit, [#150](https://github.com/guidepup/guidepup/commit/2573d62f73df50ce13c12d91d6ac57311fab9553) (2026-09-20), which fails `start()` early with "macOS version not supported" | Unreleased only |
| `@guidepup/setup` | Not versioned in earlier notes | 0.25.3, equal to the local pin in [`packages/guest/package.json`](../packages/guest/package.json) line 22. 0.25.0 added Orca on Linux ([release 0.25.0](https://github.com/guidepup/setup/releases/tag/0.25.0)) | New reader family, nothing for macOS or Windows |
| `@guidepup/virtual-screen-reader` | Mentioned, no version | 0.33.0 released 2026-09-20, the first release since 0.32.1 on 2025-05-19 ([releases](https://github.com/guidepup/virtual-screen-reader/releases)). Release notes are dependency bumps plus a timer change ([PR #231](https://github.com/guidepup/virtual-screen-reader/pull/231)) | Yes, minor |
| Issue #101 (VoiceOver not fully quitting) | Cited as the closest Tahoe issue | **Closed** 2026-06-14 in favour of [#113](https://github.com/guidepup/guidepup/issues/113), itself closed the same day; fix shipped as 0.25.1 "prevent VO commands after stop is initiated" ([release 0.25.1](https://github.com/guidepup/guidepup/releases/tag/0.25.1)) | State now recorded |
| Issue #129 (event-driven speech capture) | Open proposal | Still open, no new comments since 2026-07-21 ([#129](https://github.com/guidepup/guidepup/issues/129)) | No |
| macOS 27 | Not known | New: [#149](https://github.com/guidepup/guidepup/issues/149) (2026-09-15, closed 2026-09-20). No VoiceOver asset for Darwin 27 in `manifest.json`; a commenter reports `content of last phrase` returning `missing value` on macOS 27 | Yes |
| SIP-enabled Tahoe setup | Earlier note found `SCREnableAppleScript` false locally | New upstream report of the same class of failure: [setup#66](https://github.com/guidepup/setup/issues/66) (open, 2026-08-26) | Yes |
| Remote execution | "Not supplied by Guidepup" | Still true. [#76](https://github.com/guidepup/guidepup/issues/76) open since 2024-02-19, zero comments. New related item: [#141](https://github.com/guidepup/guidepup/issues/141) "at-driver protocol support" (open, 2026-08-17, links only) | No |
| New packages in the org | Not listed | `guidepup/orca`, `guidepup/manifest`, `guidepup/record`, `guidepup/voiceover`, `guidepup/setup-action` exist (`gh repo list guidepup`). `@guidepup/record` is already present locally under `node_modules/@guidepup/record` | Informational |

## 2. `@guidepup/playwright` as it exists now

### Fixture surface (Verified)

```ts
// src/nvdaTest.ts L42-L50, L132-L163
export interface NVDAPlaywright extends NVDA {
  navigateToWebContent(options?: Pick<CommandOptions, "capture">): Promise<void>;
}
export const nvdaTest = test.extend<{
  nvda: NVDAPlaywright;
  nvdaStartOptions: Pick<StartOptions, "capture" | "settings">;
}>({ nvdaStartOptions: { capture: "initial" }, nvda: async ({ browserName, page, nvdaStartOptions }, use) => { ... } });

// src/voiceOverTest.ts L35-L45, L141-L175
export interface VoiceOverPlaywright extends VoiceOver {
  navigateToWebContent(options?: Pick<CommandOptions, "capture">): Promise<void>;
}
export const voiceOverTest = test.extend<{
  voiceOver: VoiceOverPlaywright;
  voiceOverStartOptions: StartOptions;
}>({ voiceOverStartOptions: { capture: "initial" }, voiceOver: async ({ browserName, page, voiceOverStartOptions }, use) => { ... } });
```

Sources: [`src/nvdaTest.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L132-L251), [`src/voiceOverTest.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/voiceOverTest.ts#L141-L271). `screenReaderTest` has the same shape with `screenReader` and `screenReaderStartOptions` and picks the reader by OS ([`src/screenReaderTest.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/screenReaderTest.ts#L229-L261), [release 0.17.0](https://github.com/guidepup/guidepup-playwright/releases/tag/0.17.0)).

### Lifecycle (Verified)

- Both fixtures are declared with plain `test.extend` and no `{ scope: "worker" }`, so they are **test-scoped**: the reader is started before every test that requests the fixture and stopped after it. The upstream doc comment says the same: "A fresh started NVDA instance `nvda` is provided to each test" ([`nvdaTest.ts` L126-L131](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L126-L131)); the VoiceOver doc says the integration "handles starting and stopping VoiceOver for each test" ([testing-voiceover](https://www.guidepup.dev/docs/screen-reader-testing/testing-voiceover)).
- The fixture object is the module-level singleton imported from `@guidepup/guidepup` (`const nvdaPlaywright = nvda as NVDAPlaywright`, [`nvdaTest.ts` L52](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L52); same for VoiceOver at [`voiceOverTest.ts` L132-L133](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/voiceOverTest.ts#L132-L133)). `navigateToWebContent` is assigned onto that singleton on every fixture setup.
- Start is `await reader.start(startOptions)`, then `use(reader)`. Stop runs in `finally`, and a failed stop is swallowed with an empty `catch` ([`nvdaTest.ts` L241-L249](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L241-L249), [`voiceOverTest.ts` L261-L269](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/voiceOverTest.ts#L261-L269)). A reader that failed to stop is therefore invisible to the test report.
- One reader per machine, not per worker. The singleton and the OS both force it; `screenReaderConfig` sets `workers: 1` for that reason.

### Required configuration (Verified)

`screenReaderConfig` is exactly `workers: 1`, `fullyParallel: false`, `use.headless: false` ([`src/screenReaderConfig.ts` L10-L29](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/screenReaderConfig.ts#L10-L29)). Its own comment says it "may not be sufficient". Upstream examples add `timeout: 5 * 60 * 1000`, `retries: 1` or `2`, `reportSlowTests: null`, and repeat `headless: false` inside each project because `devices[...]` presets would otherwise override it ([README L132-L216](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/README.md), [`examples/playwright-voiceover/webkit.config.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/examples/playwright-voiceover/webkit.config.ts)). A headless project was the maintainer's first suspect in [guidepup-playwright#36](https://github.com/guidepup/guidepup-playwright/issues/36). The README's link to `./src/config.ts` is stale; the file is `src/screenReaderConfig.ts`.

### Browser support per reader, and how the application name is chosen (Verified)

The application name comes from one static map keyed by Playwright's `browserName` fixture ([`src/applicationNameMap.ts`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/applicationNameMap.ts#L1-L10)):

```ts
export const applicationNameMap = {
  chromium: "Google Chrome For Testing",
  chrome: "Google Chrome",
  "chrome-beta": "Google Chrome Beta",
  msedge: "Microsoft Edge",
  "msedge-beta": "Microsoft Edge Beta",
  "msedge-dev": "Microsoft Edge Dev",
  firefox: "Nightly",
  webkit: "Playwright",
};
```

- **`voiceOverTest`** is exercised upstream on Chromium, Firefox and WebKit (package scripts `test:voiceover:chromium|firefox|webkit` in [`package.json`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/package.json), CI matrix `macos-14, macos-15, macos-26` in [`test-voiceover.yml`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/.github/workflows/test-voiceover.yml)). It is not WebKit only. "Only Webkit works" was an early bug, closed 2023-01-23 ([guidepup-playwright#5](https://github.com/guidepup/guidepup-playwright/issues/5)).
- **`nvdaTest`** is exercised upstream on Chromium and Firefox (`test:nvda:chromium`, `test:nvda:firefox`; CI matrix `windows-2022, windows-2025` in [`test-nvda.yml`](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/.github/workflows/test-nvda.yml)). Firefox is supported, with a documented workaround sequence inside `navigateToWebContent` for an NVDA and Firefox focus-mode problem ([`nvdaTest.ts` L196-L225](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L196-L225)).
- **"WebKit" is not Safari and "firefox" is not release Firefox.** The map activates the app named `Playwright` for WebKit and `Nightly` for Firefox. Playwright's own documentation: "Playwright doesn't work with the branded version of Safari since it relies on patches" and "Playwright doesn't work with the branded version of Firefox since it relies on patches" ([Playwright browsers](https://playwright.dev/docs/browsers)). `devices["Desktop Safari"]` is a WebKit device preset, not Safari.app. `@guidepup/setup` likewise grants Apple Events to `org.webkit.Playwright` as a distinct bundle from `com.apple.Safari` ([`updateTccDb.ts` L23, L34](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/macOS/updateTccDb.ts#L18-L35)).
- **Inference:** the `chrome`, `msedge` and beta/dev keys in the map are unreachable. Playwright's `browserName` only takes `"chromium" | "firefox" | "webkit"`, and `channel` is a separate option that does not change it ([TestOptions](https://playwright.dev/docs/api/class-testoptions)). With `channel: "chrome"` the fixture would still resolve `"Google Chrome For Testing"`. On NVDA this is mostly harmless because focus detection also accepts a window title that starts with the page title ([`nvdaTest.ts` L79-L93](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L79-L93), added by [PR #32](https://github.com/guidepup/guidepup-playwright/pull/32)). On VoiceOver it would call `macOSActivate("Google Chrome For Testing")` against a machine running branded Chrome. I did not run this; it is a reading of the source.

### `navigateToWebContent` implementations (Verified)

- **NVDA** ([`nvdaTest.ts` L172-L239](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/nvdaTest.ts#L172-L239)): exit focus mode; `reportTitle` and compare with page title or application name; if not focused, cycle windows with Alt+Escape up to `MAX_APPLICATION_SWITCH_RETRY_COUNT = 10` with a 500 ms delay each; `page.bringToFront()`, then focus, click and blur `body`; run the Firefox focus-mode workaround; clear and restore both logs; finally Ctrl+Home with the caller's `capture` option. It does not use `windowsActivate`. The infinite-switching bug was fixed in 0.16.3 ([release](https://github.com/guidepup/guidepup-playwright/releases/tag/0.16.3)).
- **VoiceOver** ([`voiceOverTest.ts` L183-L259](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/voiceOverTest.ts#L183-L259)): `macOSActivate(applicationName)`; press Control to cancel auto-navigation; `page.bringToFront()`; **inject a hidden read-only text input with id `__guidepup_marker__` at the top of `body`**; open the Item Chooser in a `while` loop that only ends when the last spoken phrase contains "item chooser"; type "web content" one character at a time until VoiceOver says "web content"; Enter; `interact()`; clear and restore logs; `next({ capture })`; remove the marker in `finally`.
- **Two facts here collide with sr-receipts' own findings.** First, the `openItemChooser` loop has **no attempt limit** ([`voiceOverTest.ts` L69-L89](https://github.com/guidepup/guidepup-playwright/blob/897b0ff/src/voiceOverTest.ts#L69-L89)), and this repository's Safari adapter records that macOS 26 "never speaks the words Item Chooser" and announces a generic VoiceOver menu instead ([`packages/guest/voiceover/safari.ts`](../packages/guest/voiceover/safari.ts) lines 22 to 29). **Inference:** on this Mac the upstream loop would spin until the Playwright test timeout. Upstream CI passes on `macos-26`, so the wording may depend on point release or on the mounted Guidepup preferences; I could not determine which. Second, the adapter mutates the page DOM during navigation, which a transcript rig should know about even though the marker is removed afterwards.

### API bridge and limits (Verified)

- `reader.capture(action)` wraps any Playwright interaction and returns `{ itemText, result, spokenPhrase }` ([`src/Capture.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/Capture.ts), [release 0.33.0](https://github.com/guidepup/guidepup/releases/tag/0.33.0), [adapter release 0.19.0](https://github.com/guidepup/guidepup-playwright/releases/tag/0.19.0)). Already noted in the dogwalk research; unchanged.
- Trace annotation and automatic instrumentation of Playwright commands are **not implemented**: [guidepup-playwright#41](https://github.com/guidepup/guidepup-playwright/issues/41) and [#42](https://github.com/guidepup/guidepup-playwright/issues/42), both open since 2026-06-29 with no discussion. Speech does not appear in Playwright traces or reports unless the consumer attaches it.
- No report, snapshot or verdict conventions beyond the README's `expect(JSON.stringify(await reader.spokenPhraseLog())).toMatchSnapshot()`.
- Windows ARM64: Playwright ships only x64 browser bundles on Windows, and the request for native ARM64 browsers was closed as not planned on 2026-05-12, with the maintainer noting there is no Chrome for Testing build for Windows ARM64 ([microsoft/playwright#40202](https://github.com/microsoft/playwright/issues/40202)). Playwright's system requirements mention arm64 only for Linux ([Playwright intro](https://playwright.dev/docs/intro)). **Inference:** in the UTM Windows 11 ARM64 guest, a Playwright-launched browser would be an x64 build under emulation, unlike the native Firefox the rig launches today ([`packages/guest/lib/firefox.ts`](../packages/guest/lib/firefox.ts) lines 15 to 16).

## 3. `@guidepup/guidepup`: delta from 0.34.0 to latest, and the capture facts

### Delta (Verified)

The local pin is `0.34.0` ([`packages/guest/package.json`](../packages/guest/package.json) line 21; `node_modules/@guidepup/guidepup/package.json` line 3) and npm `latest` is `0.34.0`. There is **no published delta**. `git diff 0.34.0 main -- src manifest.json package.json` touches four files, all from [#150](https://github.com/guidepup/guidepup/commit/2573d62f73df50ce13c12d91d6ac57311fab9553): `start()` now calls `getManifestAsset()` first and throws "macOS version not supported" directly instead of nesting it under "VoiceOver cannot be started". `manifest.json` on `main` still lists VoiceOver assets only for Darwin 21 to 25, that is macOS 12 to 26 ([`manifest.json`](https://github.com/guidepup/guidepup/blob/2573d62/manifest.json)). NVDA asset is `guidepup-nvda-0.2.1-2026.2.zip`, a single asset for all of `win32` with no architecture field.

For orientation, the releases that produced today's behaviour (all already inside the pin): 0.26.0 made `capture: "initial"` the default and made `type()` log one entry per character; 0.29.0 introduced manifest-driven assets and portable VoiceOver preferences; 0.30.0 added `start({ settings })` with `getSettings()`; 0.31.0 added `version`; 0.32.0 added `nextHeading`, `nextLink`, `nextLandmark` and their `previous` forms; 0.33.0 added `capture()`; 0.33.1 added teardown on process signals and a no-op when preference symlinks are already correct; 0.33.2 added `DEBUG=guidepup:*` logging; 0.34.0 moved to NVDA 2026.2 ([releases](https://github.com/guidepup/guidepup/releases)).

### The `capture` option (Verified)

```ts
// src/CommandOptions.ts at 0.34.0
capture?: true | false | "initial";   // default "initial"
retries?: number;
timeout?: number;
```

Source: [`src/CommandOptions.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/CommandOptions.ts#L1-L23). `StartOptions` adds `settings?: Record<string, unknown>`; `KeyboardOptions` adds `application?: string` ([`StartOptions.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/StartOptions.ts), [`KeyboardOptions.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/KeyboardOptions.ts)). The docs describe `"initial"` as the first "page" of output, `true` as full capture and `false` as none, with documented defaults `retries: 3` and `timeout: 10000` ([CommandOptions](https://www.guidepup.dev/docs/api/class-command-options)).

### Hard-coded polling constants, local copy (Verified)

`/Users/kny38/dev/a11y-nvda-testing/node_modules/@guidepup/guidepup/lib/macOS/VoiceOver/constants.js`:

| Line | Constant | Value |
| --- | --- | --- |
| 4 | `SPOKEN_PHRASES_POLL_INTERVAL` | `50` ms |
| 5 | `SPOKEN_PHRASES_RETRY_COUNT` | `25` (stable polls needed to finish a full capture) |
| 6 to 7 | `MAX_SPOKEN_PHRASES_POLL_COUNT` | `25 * 4 = 100` |
| 8 | `ITEM_TEXT_POLL_INTERVAL` | `50` ms |
| 9 | `ITEM_TEXT_RETRY_COUNT` | `10` |
| 10 | `APPROX_WORDS_PER_SECOND` | `90 / 12 = 7.5` |

`/Users/kny38/dev/a11y-nvda-testing/node_modules/@guidepup/guidepup/lib/constants.js`: line 4 `DEFAULT_RETRY_COUNT = 3`, line 5 `DEFAULT_MUTATING_ACTION_RETRY_COUNT = 1`, line 6 `DEFAULT_POLL_INTERVAL = 1000`, line 7 `DEFAULT_TIMEOUT = 10000`, line 11 `DEFAULT_CAPTURE = "initial"`. None of these are configurable through the public API. The same values are on `main` ([`src/macOS/VoiceOver/constants.ts`](https://github.com/guidepup/guidepup/blob/2573d62/src/macOS/VoiceOver/constants.ts)).

### How polling uses them, local copy (Verified)

`/Users/kny38/dev/a11y-nvda-testing/node_modules/@guidepup/guidepup/lib/macOS/VoiceOver/VoiceOverClient.js`:

- Lines 135 to 144: after each action, if capture is on, item text and spoken phrase are polled in parallel and one entry is pushed to each log.
- Lines 159 to 175: item text is polled up to 10 times at 50 ms, errors swallowed, first non-empty value wins, otherwise `""`.
- Lines 176 to 238: spoken phrases. A fixed 50 ms delay first (line 179). Each poll swallows AppleScript errors (lines 187 to 193). A phrase equal to the previous log entry is ignored only while `pollCount < 12.5` (lines 201 to 205). A new phrase schedules the next poll after `words / 7.5` seconds plus 50 ms (lines 213 to 219). Full capture ends after 25 consecutive identical polls (line 221) or 100 polls (line 185).
- **Lines 225 to 228: with `capture: "initial"` the loop breaks after the first poll, unconditionally.** So the default mode is one AppleScript read roughly 50 ms plus one `osascript` round trip after the action. If that read fails, is empty, or still equals the previous phrase, nothing is pushed to `phrases` and the log entry is `""`.

**Inference:** `"initial"` is fast but structurally lossy on VoiceOver: a repeated announcement (two adjacent cells with the same text, for example) or a slow VoiceOver yields an empty entry. `capture: true` costs at least 25 polls, about 1.25 s plus `osascript` overhead per command. For transcript evidence sr-receipts should choose the mode deliberately per step rather than inherit the adapter default. This is a reading of the code, not a measurement.

### What `voiceOver.start()` does to the machine (Verified)

At tag 0.34.0, [`src/macOS/VoiceOver/VoiceOver.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/VoiceOver.ts): `#START_ATTEMPTS = 2` (L52), `#STOP_ATTEMPTS = 2` (L56). `start()` (L358) first terminates any running VoiceOver process (L374), then calls `mountGuidepupPreferences()` (L385), then terminates again and launches `VoiceOverStarter` (L393 onward). `stop()` (L447) terminates and calls `unmountGuidepupPreferences()` (L477). Mounting means: detach and attach a preferences DMG from the Guidepup cache, trust a portable identifier, restart the preferences daemon twice, and replace preference files with symlinks into `/Volumes/GuidepupVoiceOverPreferences` ([`mountGuidepupPreferences.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/preferences/mountGuidepupPreferences.ts#L14-L52), paths visible in [#137](https://github.com/guidepup/guidepup/issues/137)). Launch is `VoiceOverStarter`, a fixed 500 ms delay, then `activate` ([`start.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/start.ts)).

Consequences for sr-receipts: (a) transcripts are taken under Guidepup's bundled VoiceOver preferences, not the owner's, which is good for reproducibility and should be recorded in each receipt together with `voiceOver.version`; (b) a test-scoped fixture pays this whole cycle per test; (c) an owner who has VoiceOver running will have it killed.

### NVDA locality (Verified, extends the earlier note)

The client still connects to `NVDA_HOST = "127.0.0.1"`, `NVDA_PORT = 6837` ([`constants.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/windows/NVDA/constants.ts)) over TLS, and reads its CA from the local NVDA install under `userConfig/remoteAccess/localRelay/NvdaRemoteRelay.pem` with a legacy add-on fallback ([`NVDAClient.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/windows/NVDA/NVDAClient.ts)). NVDA is found only at `<cache>/nvda/all/<asset version>/extracted/nvda.exe` ([`getNVDAInstallationPath.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/windows/NVDA/getNVDAInstallationPath.ts)). `windowsActivate`, `windowsQuit` and `sendKeys` shell out to `cscript` with a generated `.vbs` file ([`runVbsScript.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/windows/runVbsScript.ts), [`activate.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/windows/activate.ts)). **Inference:** the transport is NVDA's remote-access relay, so a cross-machine client is conceivable in principle, but host, port and CA path are hard-coded and not options, so it would be a fork, not configuration.

## 4. `@guidepup/setup`

### Commands and flags (Verified)

Two subcommands ([`src/index.ts`](https://github.com/guidepup/setup/blob/5b5a1db/src/index.ts)): `setup [--ci] [--macos-ignore-tcc-db] [--macos-record]` ([`commands/setup/index.ts` L43-L52](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/index.ts#L43-L52)) and `install [screenReaders...]` with no flags ([`commands/install/index.ts`](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/install/index.ts#L40-L45)). `install` reads the manifest of the locally installed `@guidepup/guidepup`, downloads assets from GitHub releases with SHA-256 verification, and prunes unused ones. Cache: `~/Library/Caches/guidepup` on macOS, `%LOCALAPPDATA%\guidepup` on Windows, overridable with `GUIDEPUP_SCREEN_READERS_PATH`; `HTTPS_PROXY` is honoured ([`resolve-cache-path.ts`](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/install/resolve-cache-path.ts), [machine setup guide](https://www.guidepup.dev/docs/guides/machine-setup)). `install` must be rerun after every Guidepup upgrade ([support matrix](https://www.guidepup.dev/docs/reference/support-matrix)).

### Windows (Verified)

`setup` does **nothing** on Windows: the `win32` case is an empty `break` ([`commands/setup/index.ts` L18-L21](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/index.ts#L18-L21)). All Windows work is `install nvda`, which unpacks a portable NVDA 2026.2 build preconfigured by [guidepup/nvda](https://github.com/guidepup/nvda). No registry, foreground-lock or architecture handling remains in the CLI.

### macOS (Verified)

In order ([`macOS/setup.ts`](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/macOS/setup.ts#L26-L108)):

1. Unless `--macos-ignore-tcc-db`, `INSERT OR IGNORE` rows straight into the user `TCC.db`, then the system `TCC.db` (system failure is swallowed). Services: PostEvent, Accessibility, SystemPolicyAllFiles, Microphone, ScreenCapture, and AppleEvents towards System Events, VoiceOver, VoiceOver Utility, Finder, Safari, Firefox, Firefox Nightly, Opera, Chrome variants, Chromium, Edge variants, Playwright WebKit and WebKit. The **clients** granted are fixed: `/usr/sbin/sshd`, `/bin/bash`, `/bin/zsh`, `/usr/bin/osascript`, `com.apple.Terminal`, and GitHub, GitLab and CircleCI runner paths ([`updateTccDb.ts` L7-L60](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/macOS/updateTccDb.ts#L7-L60)).
2. If the write fails and `--ci` is not set, it prints a note telling the user to accept system dialogs; with `--ci` it throws.
3. `defaults write com.apple.VoiceOver4/default SCREnableAppleScript -bool true`, disable the VoiceOver splash screen, disable dictation auto-enable, make sure `com.apple.VoiceOver4.local.plist` exists (starting and stopping VoiceOver once if needed; on Darwin 24 and later the file lives under `~/Library/Group Containers/group.com.apple.VoiceOver/`), and with `--ci` turn on Do Not Disturb.
4. Write `/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled` containing `a`, **only if SIP is disabled** ([`setup.ts` L90-L94](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/macOS/setup.ts#L90-L94), [`writeDatabaseFile.ts`](https://github.com/guidepup/setup/blob/5b5a1db/src/commands/setup/macOS/writeDatabaseFile.ts)).
5. Otherwise, if both the defaults key and the marker file already read as enabled, succeed; else with `--ci` throw "Unable to setup environment without manual user interaction", and without `--ci` print the manual guide link and still finish with the success banner.

### What it cannot do, macOS 26 in particular

- **Verified:** on a SIP-enabled Mac it cannot enable "Allow VoiceOver to be controlled with AppleScript". That step is manual in VoiceOver Utility ([manual VoiceOver setup](https://www.guidepup.dev/docs/guides/manual-voiceover-setup)). The maintainer reports that on Tahoe 26.4.1 even `sudo touch` of the marker file fails with "Operation not permitted", and Full Disk Access does not help ([setup#66](https://github.com/guidepup/setup/issues/66), comment of 2026-08-26). The issue reporter states that on macOS 26.5 the legacy `defaults write` is no longer honoured and the marker file is the real gate, with `-1708` on every VoiceOver-suite command when it is absent. That matches the symptom this repository recorded (`-1728` on reads, `-1708` on commands, fixed by enabling the setting), so the local finding now has an upstream counterpart. The reporter also states a macOS upgrade can silently drop a previously enabled state; treat that as an unconfirmed single report.
- **Verified:** direct `TCC.db` writes need SIP off (the docs say so for the CI path). On a normal Mac the grants come from consent dialogs or System Settings.
- **Inference:** Ghostty is not among the hard-coded TCC clients, so even on a machine where the database write succeeds, the owner's terminal would not be granted. Accessibility and Automation consent for Ghostty remains a manual step that a `doctor` command can detect but not perform.
- **Verified:** `setup` reports success even when manual steps remain (that is [setup#61](https://github.com/guidepup/setup/issues/61), closed, and the residue is setup#66). sr-receipts should keep its own preflight rather than trust the exit status.

## 5. Virtual Screen Reader

**Claims (Verified, [README](https://github.com/guidepup/virtual-screen-reader/blob/06d4294/README.md)):** "a screen reader simulator for unit tests"; mirrors screen reader functionality; test-framework agnostic (Jest, Vitest, Web Test Runner, Storybook, plain script); UI-framework agnostic; fast feedback by "running virtually over the provided DOM". It aims to be as "spec compliant" as possible against W3C specifications, tests its accessibility-tree modules against Web Platform Tests, and uses a11ysupport.io as a guide "in the absence of anything formal for screen reader output".

**Non-claims (Verified, same README):** "This package should not replace but augment your screen reader testing, there is no substitute for testing with real screen readers and with real users." And: "There is currently no explicit specification for screen readers to adhere to". It does not model NVDA or VoiceOver wording, browse or focus modes, or browser accessibility-tree differences; its output vocabulary is its own (for example `"heading, Section Heading, level 1"`, `"end of navigation"`). The docs site repeats the disclaimer ([introduction](https://github.com/guidepup/guidepup.dev/blob/80263c7/docs/virtual-screen-reader/introduction.md)). Machine setup is not required for it ([machine setup](https://www.guidepup.dev/docs/guides/machine-setup)).

**API shape (Verified):** `import { virtual } from "@guidepup/virtual-screen-reader"`; `await virtual.start({ container: document.body })`; then the same verbs as the real readers (`next()`, `act()`, `perform()`, `lastSpokenPhrase()`, `spokenPhraseLog()`, `itemText()`), then `await virtual.stop()`. Node `>=20`. Version 0.33.0.

**Inference:** its role in the roadmap is unchanged from dogwalk option D: a fast DOM-level tier whose transcripts must never be stored or labelled as NVDA or VoiceOver receipts.

## 6. `@guidepup/jest`

**Verified:** it still exists and is not archived. Last release 0.5.2 on 2024-09-14 ([releases](https://github.com/guidepup/jest/releases)); repository activity since is dependency bumps (latest 2026-09-11). Peers: `@guidepup/virtual-screen-reader >=0.26.0`, `jest >=29`. It is **not a fixture and not for real readers**. The pattern is matcher registration by side-effect import (`import "@guidepup/jest"` in a Jest setup file), giving `expect(element).toMatchScreenReaderSnapshot()` and `toMatchScreenReaderInlineSnapshot()`, which walk the Virtual Screen Reader from top to bottom and snapshot the phrase array ([README](https://github.com/guidepup/jest/blob/main/README.md)). It carries the same "should not replace your manual screen reader testing" note. Not relevant to the Playwright roadmap except as a naming precedent for snapshot matchers.

## 7. Relevant issues

| Issue | State | Date | Why it matters to sr-receipts |
| --- | --- | --- | --- |
| [guidepup#76](https://github.com/guidepup/guidepup/issues/76) Remote control of screen readers | Open | 2024-02-19, last touched 2026-08-02 | The only upstream statement on remote execution. Proposes a possible `@guidepup/remote`, cites AmadeusITGroup Assistive-Webdriver as prior art, has zero comments. The boundary sr-receipts needs does not exist upstream. |
| [guidepup#141](https://github.com/guidepup/guidepup/issues/141) at-driver protocol support | Open | 2026-08-17 | A standards-based remote protocol is only a placeholder with two links. |
| [guidepup#149](https://github.com/guidepup/guidepup/issues/149) No manifest asset for this platform | Closed by #150, unreleased | 2026-09-15, closed 2026-09-20 | macOS 27 is unsupported by 0.34.0; a commenter reports `content of last phrase` returns `missing value` there. Do not upgrade the VoiceOver Mac past macOS 26 until upstream ships an asset and the read path is confirmed. |
| [setup#66](https://github.com/guidepup/setup/issues/66) `setup` reports success on SIP-enabled Tahoe but AppleScript control stays disabled | Open | 2026-08-26, updated 2026-09-08 | Upstream counterpart of this repo's own `-1708`/`-1728` finding. Maintainer proposes an interactive flow that opens VoiceOver Utility and polls for the marker file. |
| [guidepup-playwright#43](https://github.com/guidepup/guidepup-playwright/issues/43) `navigateToWebContent` has no effect in the example test | Open | 2026-07-03, last comment 2026-09-08 | Live evidence that the adapter's VoiceOver navigation stalls on a real Sequoia machine (0.19.1 with core 0.34.0) while upstream CI passes. Debug log supplied 2026-09-08, no diagnosis yet. |
| [guidepup-playwright#41](https://github.com/guidepup/guidepup-playwright/issues/41), [#42](https://github.com/guidepup/guidepup-playwright/issues/42) Instrument Playwright commands; Annotate traces | Open | 2026-06-29 | Speech is not in Playwright traces. If receipts should appear in Playwright reports, sr-receipts must attach them itself. |
| [guidepup-playwright#36](https://github.com/guidepup/guidepup-playwright/issues/36) `itemText` and `lastSpokenPhrase` empty on Sequoia | Closed | 2026-05-28, closed 2026-06-14 | Root cause was VoiceOver auto-navigation on page load; led to the Control key cancel and the Item Chooser route. Documents that "Automatically speak the web page" interferes with capture. |
| [guidepup#137](https://github.com/guidepup/guidepup/issues/137) Sequoia permissions issues (`EEXIST` on preference symlink) | Closed | 2026-08-14, closed 2026-08-16 | Start failure after a cancelled run. Fixed in 0.33.1 (symlink no-op and teardown on signals). Shows that an interrupted run can poison the next start. |
| [guidepup#113](https://github.com/guidepup/guidepup/issues/113) `voiceOver` fixture leaves VO on after teardown | Closed | 2026-06-13, closed 2026-06-14 | Maintainer's diagnosis: a Playwright timeout aborts the test but not the in-flight `osascript`, which reactivates VoiceOver after `stop()`, including the welcome announcement. Fixed in 0.25.1. This is the mechanism behind greeting text appearing in logs after a timeout. |
| [guidepup#101](https://github.com/guidepup/guidepup/issues/101) VoiceOver does not seem to fully quit | Closed in favour of #113 | 2025-11-13, closed 2026-06-14 | Already cited in this repo; record it as closed. |
| [guidepup#100](https://github.com/guidepup/guidepup/issues/100) Failure on `start()` if VoiceOver already started | Closed | 2025-11-13, closed 2026-06-22 | `start()` now terminates a running VoiceOver first; it still throws if the same instance is already started or starting. |
| [guidepup#129](https://github.com/guidepup/guidepup/issues/129) Event-driven VoiceOver speech capture | Open | 2026-07-21 | Would replace the polling described in section 3 without changing the public API. No progress. |
| [guidepup#130](https://github.com/guidepup/guidepup/issues/130) Explore `XCUIVoiceOverService` APIs | Open | 2026-07-21 | Possible future replacement for AppleScript control. Link only. |
| [guidepup#87](https://github.com/guidepup/guidepup/issues/87) Poor `osascript` performance on Sonoma | Open | 2024-09-10, updated 2026-08-02 | Multi-second gaps per command reported; bounds how fast any VoiceOver walk can be. |
| [guidepup#89](https://github.com/guidepup/guidepup/issues/89) VoiceOver configuration does not work on Sequoia | Closed | 2024-09-12, closed 2026-08-02 | Resolved by the portable preferences DMG; explains why `start()` now mounts a volume. |
| [guidepup#115](https://github.com/guidepup/guidepup/issues/115) NVDA after v0.25.0 is too fast for speak | Closed | 2026-06-19 | NVDA-side counterpart of the capture-mode change; relevant when choosing `capture` for NVDA transcripts. |
| [microsoft/playwright#40202](https://github.com/microsoft/playwright/issues/40202) Support Windows Arm64 browsers | Closed, not planned | 2026-04-14, closed 2026-05-12 | Playwright browsers in the ARM64 guest would be x64 under emulation. |

**Searched and found nothing (Verified as absence in the issue lists, not proof of absence in the wild):** no Guidepup issue or PR mentions NVDA on ARM64 Windows, UTM or VM execution, AppleScript error `-600`, `readTableColumnHeader`, or table commands misfiring. `readTableColumnHeader` is defined as VO-C and `readTableColumn` as VO-C-C ([`keyCodeCommands.ts` L254-L271](https://github.com/guidepup/guidepup/blob/2573d62/src/macOS/VoiceOver/keyCodeCommands.ts#L254-L271)). **Inference:** because the column command is the header command pressed twice, timing between the two key codes is a plausible source of misfires, but nobody has reported it upstream.

## 8. Does this change the dogwalk recommendation?

**The core recommendation stands, and the evidence for it is stronger.**

Verified:
- The fixtures import process-local singletons and call `start()` in the Playwright worker process. NVDA is reached on `127.0.0.1:6837` with a CA read from the local disk; VoiceOver is driven by local `osascript` and `VoiceOverStarter`. None of these are options.
- The docs' reliability list begins "Run on the operating system required by the screen reader" and says nothing about remote, VM or cross-machine execution. A grep of the docs source for "remote", "virtual machine" and "VM" returns nothing on the topic ([testing with real screen readers](https://www.guidepup.dev/docs/screen-reader-testing/testing-with-real-screen-readers), [CI/CD](https://www.guidepup.dev/docs/getting-started/ci-cd)).
- The only upstream remote work is two open placeholder issues (#76, #141).

So "run Playwright beside the reader, orchestrate remotely, build a host-native fixture only when justified" remains correct. For VoiceOver the question mostly dissolves: the reader machine is the owner's Mac, so Playwright runs natively there with no remote hop.

**What the new findings add to the roadmap (my inference, built on the verified facts above):**

1. **Decide the browser question before anything else.** Using upstream `voiceOverTest` and `nvdaTest` means testing Playwright WebKit, Playwright's Firefox build, or Chromium. Keeping Safari.app and release Firefox, which is what real users run and what the current baselines record, means sr-receipts cannot use Playwright's `page` for those targets at all, since Playwright cannot drive them. The realistic shapes are: (a) sr-receipts ships its own Playwright Test fixtures built directly on `@guidepup/guidepup`, reusing its existing Safari and Firefox launchers, with Playwright as runner, reporter and snapshot engine but no `page`; (b) sr-receipts re-exports the upstream fixtures and accepts Playwright-built browsers, with new baselines labelled by browser build; or (c) both, as separate named targets. This is an architecture decision for the owner, not something the sources settle.
2. **Do not depend on upstream `voiceOver.navigateToWebContent()` on this Mac without a spike.** Its Item Chooser loop is unbounded and matches a phrase this repo has recorded macOS 26 not speaking. sr-receipts' bounded, error-reporting version in `packages/guest/voiceover/safari.ts` is the safer convention, and a candidate upstream contribution.
3. **Fixture scope is a convention sr-receipts should own.** Upstream restarts the reader per test, which on macOS includes a DMG mount and two preference daemon restarts, and it swallows stop failures. A worker-scoped reader with per-test log clearing, plus a stop failure that is reported, would be faster and more honest. Upstream does not offer this.
4. **Capture mode is a convention too.** The adapter defaults to `"initial"`, which on VoiceOver is a single poll. Receipts that claim to be transcripts should set capture explicitly.
5. **The ARM64 guest is a second unknown stacked on the first.** Guidepup's manifest has no architecture field, Playwright has no native Windows ARM64 browsers, and nobody upstream has reported on either. Option A (guest-native Playwright) needs a smoke test in the UTM guest before it is put on a roadmap with a date.
6. **Pin the VoiceOver Mac below macOS 27** and pin `@guidepup/guidepup`, `@guidepup/setup` and the installed assets together, since `install` must be rerun per Guidepup version.

## 9. Unknowns

- **Whether `@guidepup/playwright` runs at all in the Windows 11 ARM64 UTM guest.** Not tested here (nothing was installed, per instructions), and no upstream report exists. Playwright's docs are silent on Windows ARM64; the only source is the closed issue cited above.
- **Whether upstream `voiceOver.navigateToWebContent()` works on this Mac (macOS 26.6).** The mismatch with the "Item Chooser" wording is a reading of two sources. Claude cannot run VoiceOver in this environment, so it needs an owner-run spike.
- **Why upstream CI passes on `macos-26` while guidepup-playwright#43 stalls on a real machine.** The reporter's debug log is an attachment I did not download; the maintainer has not yet responded to it.
- **The macOS 27 `missing value` report** in guidepup#149 is a single commenter's observation, unconfirmed by the maintainer.
- **The setup#66 claim that macOS 26.5 ignores the `SCREnableAppleScript` default entirely** is the reporter's analysis. The maintainer disputed part of the report (the marker file cannot be written with `sudo` on 26.4.1). Which of the two gates fixed this repo's Mac was not re-examined.
- **GitHub issue keyword search was partly rate limited** (HTTP 403 on `gh search issues` midway). I reran the important terms ("remote", "arm64", "-600", "table") across the whole `guidepup` organisation afterwards, and read the complete issue lists of `guidepup/guidepup`, `guidepup/guidepup-playwright`, `guidepup/setup` and `guidepup/nvda` by title. The terms "TCC", "UTM", "VM" and "greeting" were not rerun as searches; they were checked only against issue titles and the issues read in full.
- **guidepup.dev API reference pages** for `nvda`, `voiceOver`, `macOSActivate`, `windowsActivate` and `KeyboardOptions` were not fetched as rendered pages. I read the TypeScript sources those pages are generated from (`typedoc`) and the rendered `CommandOptions` page. One guessed docs URL (`/docs/virtual-screen-reader-testing/...`) returned 404; the correct section is `/docs/virtual-screen-reader/`, read from the docs repository.
- **NVDA 2026.2 on ARM64** (whether the portable build in `guidepup/nvda` is x86, x64 or ARM64, and how it behaves under Windows on ARM emulation) was not examined; the asset was not downloaded.
- **`cscript`/VBScript availability** in the guest matters for `windowsActivate`, `windowsQuit` and `sendKeys`. I did not check Microsoft's current VBScript deprecation schedule against a primary source, so no claim is made here beyond the fact that Guidepup depends on it.
