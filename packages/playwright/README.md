# @sr-receipts/playwright

A `reader` fixture for Playwright Test, so a consuming repo drives a real
screen reader beside Playwright's own `page` from its own `playwright test`.

Playwright drives the browser. For a VoiceOver project that is the browser
Playwright launched on this Mac; for an NVDA project it is the guest's Edge,
reached through Playwright's own `connectOptions`. The reader comes from the
fixture: VoiceOver in process, NVDA through the guest daemon. Both are the
same `ReaderSession`, so a spec never says which one it has. Why, and what was
given up for it, is in
[ADR 0002](../../docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

## Ownership

This package owns `readerFixtures`, the `reader` fixture and its
`readerOptions`, and what happens around a test: starting and stopping the
session, and attaching the transcript and the environment stamp.

It depends on `@sr-receipts/host` for the interface and the NVDA session, and
imports only types from `@playwright/test`, which is a peer dependency.
`@sr-receipts/guest` is an optional peer, loaded only when a VoiceOver project
runs, so an NVDA-only consumer never installs Guidepup.

## Use

Extend the consumer's own `test`. The package exports fixtures rather than a
`test`, because a linked package would otherwise load a second copy of
Playwright, which Playwright refuses to run with.

```ts
// receipts/columnlist-selection.spec.ts
import { test as base, expect } from '@playwright/test'
import { readerFixtures } from '@sr-receipts/playwright'

const test = base.extend(readerFixtures)

test('selecting a row through the page is announced', async ({ page, reader }) => {
  await page.goto('/demo/columnlist')
  await reader.enter(page)
  const { spoken } = await reader.capture(() => page.getByLabel('select row').first().click())
  expect(spoken).toMatch(/1 row selected/)
  expect(await reader.next()).toMatch(/column 2/)
})
```

Give it a config of its own, so the repo's ordinary `playwright test` never
asks for a reader, and a test directory the ordinary config does not match:

```ts
// playwright.receipts.config.ts
import { defineConfig } from '@playwright/test'
import type { ReaderOptions } from '@sr-receipts/playwright'

export default defineConfig<{}, { readerOptions: ReaderOptions }>({
  testDir: 'receipts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  use: { headless: false },
  projects: [{
    name: 'voiceover',
    use: {
      browserName: 'webkit',
      baseURL: 'http://localhost:5176',
      readerOptions: { reader: 'voiceover' },
    },
  }, {
    name: 'nvda',
    use: {
      connectOptions: { wsEndpoint: process.env.RIG_BROWSER ?? 'ws://unset' },
      baseURL: 'http://192.168.64.1:5176',
      readerOptions: { reader: 'nvda', url: process.env.RIG_URL ?? '', token: process.env.RIG_TOKEN ?? '' },
    },
  }],
})
```

- **`workers: 1` and `retries: 0` are required.** One reader holds one
  desktop. A retry that turns a finding green destroys the evidence.
- **`headless: false`.** A screen reader needs a window to read.
- **`baseURL` is wherever the reader's browser reaches the app.** For NVDA
  that is the Mac as the guest sees it, and the dev server has to listen on
  that interface (`vite dev --host 0.0.0.0`), not only on `localhost`. For
  VoiceOver the browser runs on the Mac, so it is `localhost`.
- **`RIG_URL`, `RIG_BROWSER` and `RIG_TOKEN`** are the guest daemon's, for the
  NVDA project only; see
  [`docs/operating-the-rig.md`](../../docs/operating-the-rig.md). The
  consumer's `@playwright/test` must share the guest's Playwright
  major.minor, or `connect` refuses.
- **A VoiceOver test takes over the Mac's desktop**, and `playwright test`
  has to be launched from the app holding the grants in
  [`packages/guest/voiceover/README.md`](../guest/voiceover/README.md). Run
  `npm run voiceover:doctor` in `packages/guest` first. The VoiceOver project's
  browser is whatever Playwright launched; `readerOptions.applicationName`
  overrides the name VoiceOver activates, which defaults from the project's
  `browserName` and `channel`.

The `reader` fixture starts a fresh reader for each test and stops it after.
What it offers:

- **`enter(page, { modeProbes? })`** puts the reader on the page's content and
  proves it. On NVDA it is the rig's guards, and a page with no table,
  heading or landmark passes its own `modeProbes`. It throws with every
  attempt in the message when the proof fails.
- **`perform(command)`, `press(key)`, `next()`, `previous()`** return what the
  reader said, `""` for silence. Commands are Guidepup's names.
- **`capture(action)`** runs a `page` action inside the reader's speech window
  and returns `{ result, spoken }`.
- **`transcript`** is every call and its answer. The fixture attaches it to
  the test as `reader-transcript`, with the environment stamp as
  `environment`, whatever the outcome. Playwright keeps them on failure.

A test's timeout is the consumer's to set. An NVDA entry costs about 28
seconds, a VoiceOver entry 15 to 25, a captured page action 1.5 seconds on
NVDA and 5 on VoiceOver; 240 seconds covers a test of a dozen steps.

## Linking it into a consumer

Until the package is published, link it without saving, so the consumer's
`package.json` and lockfile stay untouched:

```bash
npm install --no-save file:/path/to/sr-receipts/packages/playwright
```

The link is a symlink, and Playwright compiles the linked TypeScript because
its real path is outside `node_modules`. Imports resolve from that real path
too, so `@sr-receipts/host` and, for a VoiceOver project, `@sr-receipts/guest`
come from this repository's workspace without being linked themselves. The
consumer installs its own `@playwright/test`, at the guest's major.minor.

## Versioning

Pre-1.0 semantic versioning: a minor version may break the contract, and says
so in [`CHANGELOG.md`](CHANGELOG.md). Private to this repository until it is
published.

## Tests

```bash
npm test
```

What the fixture decides before a reader starts is tested here without
Playwright or a reader. The fixture against a real reader is run from a
consumer.
