# Guidepup + Playwright alongside dogwalk

Research date: current session (repository and upstream sources inspected at their current `main`/package metadata).

## Executive finding

Guidepup has an official Playwright adapter: `@guidepup/playwright`. It is a Playwright Test fixture layer, not a remote-control protocol. It starts/stops and controls a real screen reader in the same OS session as the Node process, while Playwright drives a headed browser in that session. That is a natural boundary for a test runner *inside* the Windows guest, but not for a Mac-hosted Playwright process controlling NVDA in the guest. dogwalk can expose a remote execution boundary, but doing so would be a dogwalk adapter/protocol, not something supplied by Guidepup.

## Official package and API

- Package: `@guidepup/playwright`, repository [guidepup/guidepup-playwright](https://github.com/guidepup/guidepup-playwright), MIT. Its package metadata declares peer dependencies `@guidepup/guidepup >=0.33.0` and `@playwright/test ^1.57.0`; the current upstream `main` package metadata inspected here reports version `0.19.1`.
- Install: `npm install --save-dev @guidepup/playwright @guidepup/guidepup @playwright/test`, then install machine assets with `npx @guidepup/setup setup` and `npx @guidepup/setup install`.
- Exports from the adapter source are `screenReaderConfig`, `screenReaderTest`, `voiceOverTest`, and `nvdaTest` (plus their TypeScript fixture types). Source: [`src/index.ts`](https://github.com/guidepup/guidepup-playwright/blob/main/src/index.ts).
- Typical usage imports `nvdaTest as test` from `@guidepup/playwright`, and `expect` from `@playwright/test`. The fixture supplies `{ page, nvda }`; VoiceOver uses `{ page, voiceOver }`. The fixture starts the reader before the test and stops it in `finally`, swallowing stop failure. Source: [`src/nvdaTest.ts`](https://github.com/guidepup/guidepup-playwright/blob/main/src/nvdaTest.ts).
- `screenReaderConfig` is intended to be spread into the Playwright config. The upstream docs say it configures a single worker because one screen reader cannot safely drive multiple browser instances; examples also use headed (`headless: false`) browser projects and longer timeouts/retries.
- The adapter adds `navigateToWebContent()` to the reader fixture. Tests otherwise use Guidepup's reader API: `perform(keyboardCommand)`, `next*` helpers, `lastSpokenPhrase()`, `spokenPhraseLog()`, `itemText()`, and assertions with normal Playwright `expect`.
- `screenReader.capture(() => page.getByRole(...).click())` is the official bridge for a Playwright interaction followed by captured screen-reader output. This is important for authoring tests that use both styles: DOM locators/actions remain Playwright; spoken output remains Guidepup.

Primary sources: [upstream README](https://raw.githubusercontent.com/guidepup/guidepup-playwright/main/README.md), [real-world Playwright example](https://www.guidepup.dev/docs/getting-started/real-world-example), and [real screen-reader testing guide](https://www.guidepup.dev/docs/screen-reader-testing/testing-with-real-screen-readers).

## Runtime and browser requirements

- Real VoiceOver automation requires macOS, VoiceOver, Node.js, and a supported browser (the docs give Safari as an example). Real NVDA automation requires Windows, NVDA, Node.js, and a supported browser (the docs give Chromium or Firefox as examples).
- The adapter explicitly warns that screen readers cannot operate against headless browsers. A dogwalk Playwright integration must therefore launch/use a headed browser in the interactive Windows desktop session.
- The supported-reader matrix currently lists VoiceOver on macOS and NVDA on Windows, plus a separate Virtual Screen Reader for DOM/headless unit testing. The matrix says the installed Guidepup release's `manifest.json` determines the supported reader asset and that `npx @guidepup/setup install` selects it; rerun install after upgrading Guidepup.
- This repo currently depends on `@guidepup/guidepup` (`package.json`), but does not depend on `@guidepup/playwright` or `@playwright/test`; that is consistent with the current scenario/runner product, not evidence that the adapter is already integrated.
- Guidepup upstream source makes the Windows locality constraint concrete: NVDA is started with Node's local `child_process.spawn`, its NVDA client connects to `NVDA_HOST = "127.0.0.1"` and `NVDA_PORT = 6837`, and the package checks `process.platform === "win32"`. These are implementation details rather than a promised public transport API, but they establish that a Mac process cannot simply point the official client at the guest. Sources: [`start.ts`](https://github.com/guidepup/guidepup/blob/main/src/windows/NVDA/start.ts), [`NVDAClient.ts`](https://github.com/guidepup/guidepup/blob/main/src/windows/NVDA/NVDAClient.ts), [`constants.ts`](https://github.com/guidepup/guidepup/blob/main/src/windows/NVDA/constants.ts), [`isWindows.ts`](https://github.com/guidepup/guidepup/blob/main/src/windows/isWindows.ts).
- Do not infer Windows 11 ARM64 support from the generic “Windows” label. The official Guidepup matrix does not promise a Windows architecture, and this repo's ARM64 UTM guest should be treated as a compatibility item to prove in the provisioner/smoke test (NVDA binary/asset, Node, Firefox/Chromium, and headed desktop session).

Primary sources: [Guidepup support matrix](https://www.guidepup.dev/docs/reference/support-matrix), [testing NVDA](https://www.guidepup.dev/docs/screen-reader-testing/testing-nvda), [testing VoiceOver](https://www.guidepup.dev/docs/screen-reader-testing/testing-voiceover), and [Guidepup package metadata](https://raw.githubusercontent.com/guidepup/guidepup/main/package.json).

## What “support both Playwright and Guidepup” precisely means

For an author, the natural test shape is one Playwright test process on the execution target:

```ts
import { nvdaTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";

test("announcement after adding an item", async ({ page, nvda }) => {
  await page.goto(process.env.APP_URL!);
  const capture = await nvda.capture(() =>
    page.getByRole("button", { name: "Add to cart" }).click(),
  );
  await expect(page.getByRole("status")).toContainText("Added");
  expect(capture.spokenPhrase).toContain("Added to cart");
});
```

In product terms this means:

1. Playwright owns browser lifecycle, DOM locators, assertions, tracing, retries, and test reporting.
2. Guidepup owns real-reader lifecycle, keyboard commands, reader cursor/navigation, spoken/item logs, and speech assertions.
3. `@guidepup/playwright` owns the fixture seam and per-test cleanup; dogwalk should not duplicate that lifecycle if tests execute in the guest.
4. Tests must be serialized around the one interactive desktop/reader, use a headed browser, and allow materially longer per-test timeouts.
5. A “remote dogwalk run” must define where the test Node process runs. If it runs on the guest, the host sends a test command/spec reference and receives Playwright results/artifacts. If it runs on the host, official Guidepup cannot control the guest reader without an added remote agent.

## Boundary options

### A. Guest-native Playwright + Guidepup (strongest fit)

Run `playwright test` inside the Windows guest, with `@guidepup/playwright` installed there. The test's `page` and `nvda` share the guest desktop. The application can remain host-served over the existing host-reachable URL mechanism. dogwalk's host-facing API starts a guest-side Playwright command, streams test progress, and retrieves Playwright reports/traces plus speech logs.

This preserves Guidepup's official lifecycle and avoids pretending NVDA's localhost endpoint is remote. It changes dogwalk from “submit scenarios” to “submit/identify a test command” (or adds a Playwright-specific run endpoint). Security is consequential: the current daemon already treats scenario paths as guest code execution and requires a bearer token; arbitrary Playwright test commands need the same or stricter allow-list/workspace policy.

### B. Host Playwright + remote dogwalk NVDA/browser control (most ergonomic host authoring, largest new product)

Keep test code on the Mac, but replace `@guidepup/playwright`'s local fixture with a dogwalk client fixture. dogwalk would need to launch/control a headed browser in the guest, synchronize Playwright actions or expose a browser connection, send reader commands, collect speech, handle foreground focus, serialize runs, and return artifacts. This is not an official Guidepup integration; it is a compatibility layer that may use Guidepup only inside a guest agent, or may reuse the repo's existing scenario engine.

Playwright's browser connection alone does not solve this: the official fixture still starts local NVDA and uses the local `page` to focus/bring the browser forward. A remote CDP/browser endpoint would need a separate dogwalk reader fixture and desktop/session semantics.

### C. Keep current scenario API; add Playwright as a separate execution mode

Continue shipping portable scenario files for the current deterministic NVDA transcript workflow. Add a separate `dogwalk playwright` command that runs guest-native Playwright tests and stores normal Playwright artifacts. This avoids forcing the current scenario DSL to model arbitrary Playwright code and lets consumers choose scenario-level transcript snapshots or full Playwright tests.

### D. Two-tier tests (recommended product boundary)

Offer C for real-browser/reader E2E and retain the existing scenario runner for focused transcript investigations. Use Guidepup's Virtual Screen Reader package for fast DOM-level/unit feedback where appropriate, but label it as complementary—not evidence from real NVDA. Reserve the single interactive guest rig for serialized real-reader tests. This aligns the product boundaries with the upstream distinction between Virtual Screen Reader and real screen-reader testing.

## Recommendation

Treat `@guidepup/playwright` as a guest-side execution dependency and define dogwalk's first Playwright feature as “remote orchestration of guest-native Playwright tests,” not “make Guidepup remote.” Reuse the existing daemon's host/guest URL and authenticated streaming ideas, but add an explicit Playwright run contract for test command, project, timeout, report/artifact retrieval, and one-run-at-a-time semantics. Only pursue a host-native fixture after a concrete need justifies implementing and maintaining a dogwalk remote browser/reader protocol.
