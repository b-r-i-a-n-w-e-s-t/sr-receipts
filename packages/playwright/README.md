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

This package owns `withReader` and `readerFixtures`, the `reader` fixture and
its `readerOptions`, the speech matchers, and what happens around a test: starting and stopping the
session, and attaching the transcript and the environment stamp.

It depends on `@sr-receipts/host` for the interface and the NVDA session, and
imports only types from `@playwright/test`, which is a peer dependency.
`@sr-receipts/guest` is an optional peer, loaded only when a VoiceOver project
runs, so an NVDA-only consumer never installs Guidepup.

## Use

Pass the consumer's own `test` to `withReader`. The package takes it as an
argument rather than exporting a `test`, because a linked package would
otherwise load a second copy of Playwright, which Playwright refuses to run
with. `withReader` also names the fixture types for the type checker:
Playwright's `extend` cannot infer them, so `base.extend(readerFixtures)`
runs but leaves `reader` untyped. `readerFixtures` stays exported for a
consumer composing its own fixtures, with the type arguments written out.

```ts
// receipts/columnlist-selection.spec.ts
import { test as base, expect as baseExpect } from '@playwright/test'
import { readerMatchers, withReader } from '@sr-receipts/playwright'

const test = withReader(base)
const expect = baseExpect.extend(readerMatchers)

test('selecting a row through the page is announced', async ({ page, reader }) => {
  await page.goto('/demo/columnlist')
  const firstRow = page.locator('input[type="checkbox"][id*="-select-"]:not([id$="-select-all"])').first()
  await firstRow.waitFor()
  await reader.enter(page)

  // Carbon's label covers the checkbox, so click the label, as a mouse user does.
  const selected = await reader.capture(async () => {
    await page.locator(`label[for="${await firstRow.getAttribute('id')}"]`).click()
    await expect(firstRow).toBeChecked()
  })
  expect.soft(selected).toAnnounce('1 row selected.')
  expect.soft(selected).toAnnounceCleanly()

  // Neither reader follows a click, but both follow page focus.
  await reader.capture(() => firstRow.focus())
  expect.soft(await reader.next()).toAnnounce('column 2')
})
```

The matchers take a `capture`'s result or a spoken string:

- **`toAnnounce(text)`** passes when the reader said the text. It matches
  literally, so a period needs no escaping; case-insensitively; across
  whatever whitespace the reader put between words; and never inside a longer
  word or number, so `'1 row selected'` does not match `21 rows selected`.
  A RegExp is used as it is, for what text cannot say.
- **`toAnnounceCleanly()`** fails on punctuation a listener hears as noise: a
  symbol read as a word ("dot", "period", "ellipsis"), an ellipsis, or a
  period standing alone between words. NVDA's `. ` between utterances is not
  noise.

Extend `expect` in the consumer, as with `test`, so only one Playwright is
loaded.

Move the reader with `locator.focus()` inside a `capture`, not with a click.
Use `expect.soft` for a test with several findings, so the first one does not
hide the rest.

Check that the page loaded before entering it. A missing route does not fail
fast: the reader's entry succeeds on a 404 page, which has content like any
other, and the next locator then waits out the whole test timeout. One line
turns four minutes into a clear failure:

```ts
expect((await page.goto('/demo/columnlist'))?.ok()).toBe(true)
```

`--grep` and `--grep-invert` match test titles, not what a test does, so a
path or issue number that appears only inside the test body selects nothing.
Put what you will want to filter on in the title, and check a filter with
`--list` before a long run.

Give it a config of its own, so the repo's ordinary `playwright test` never
asks for a reader, and a test directory the ordinary config does not match:

```ts
// playwright.receipts.config.ts
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'
import type { ReaderOptions } from '@sr-receipts/playwright'

// RIG_URL, RIG_BROWSER and RIG_TOKEN from a gitignored .env.rig, unless the
// shell already set them.
const envFile = new URL('.env.rig', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

export default defineConfig<{}, { readerOptions: ReaderOptions }>({
  testDir: 'receipts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'receipts-report' }]],
  webServer: {
    command: 'npx vite dev --host 0.0.0.0 --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: true,
  },
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
  [`docs/operating-the-rig.md`](../../docs/operating-the-rig.md). The config
  above reads them from `.env.rig`; sourcing that file in the shell works too.
  The consumer's `@playwright/test` must share the guest's Playwright
  major.minor, or `connect` refuses. The guest's version is in `/health`'s
  environment stamp.
- **`webServer` listens on every interface** for the NVDA project's sake, and
  `reuseExistingServer` lets a dev server you already started serve both
  projects.
- **`reporter` writes its own report folder**, apart from the ordinary
  config's. Passing `--reporter` on the command line replaces both reporters,
  so no HTML report is written and the folder keeps the previous run's.
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
  and returns `{ result, spoken }`. The action must not call the reader; such
  a call is refused rather than left waiting for the capture it is inside.
- **Calls run one at a time**, in the order they were made, on either reader,
  so a `Promise.all` over two reader calls never interleaves keystrokes.
  Every call rejects rather than throws, and a failed one leaves a line in
  the transcript.
- **`transcript`** is every call and its answer. The fixture attaches it to
  the test as `reader-transcript`, with the environment stamp as
  `environment`, whatever the outcome, so a passing test in the HTML report
  carries them too.

A test's timeout is the consumer's to set. An NVDA entry costs about 28
seconds, a VoiceOver entry 15 to 25, a captured page action 1.5 seconds on
NVDA and 5 on VoiceOver; 240 seconds covers a test of a dozen steps.

## Reading a receipt

A receipt is two attachments on each test, passed or failed:
`reader-transcript`, every call to the reader and its answer, with the entry's
proof at the top; and `environment`, what produced the speech.

Open the report from the consumer repo:

```bash
npx playwright show-report receipts-report
```

Click a test, then scroll to its **Attachments**, where both are expandable
text.

- **The report is the only copy.** The fixture attaches the text to the
  report rather than writing files, so `test-results/` holds traces and error
  context but no transcripts.
- **Each run replaces the report.** It holds the latest run only, and a
  `--project nvda` run leaves only NVDA's tests in it. Copy a transcript out
  before the next run if a ticket will cite it.
- **The report server keeps running** until it is stopped. A second
  `show-report` then fails with `EADDRINUSE` on port 9323. The running server
  reads the folder on each request, so reloading its page shows the latest
  run; otherwise stop it, or pass `--port 9324`.

Reading what was said:

- **An NVDA `spoken` string is several utterances joined.** Guidepup joins
  the parts of one utterance with `, ` and separate utterances with `. `
  (`NVDAClient.js` in `@guidepup/guidepup`). So `available.. main landmark` is
  the page's own period, then the join: NVDA did not say it twice. The
  utterances after an announcement are usually NVDA reading where it landed.
- **A VoiceOver `spoken` string is one phrase**, VoiceOver's last, with the
  sentinel and hints removed.
- **Before calling a finding a component bug, check the DOM held what the
  reader said.** A `MutationObserver` on the region, in an ordinary
  Playwright script, shows every text the page actually went through. If the
  reader spoke a text the DOM never held, the cause is how the reader read the
  change, and the fix is shaped by that: for example, NVDA announces an
  `aria-atomic` region once per changed text node, and can pair a new node
  with a stale one.

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
consumer installs its own `@playwright/test`, at the guest's major.minor. If
its lockfile pins another version, install the guest's over it in the same
command, also without saving:

```bash
npm install --no-save @playwright/test@1.63.0 file:/path/to/sr-receipts/packages/playwright
```

Any later `npm ci` or `npm install` in the consumer undoes both, so check
`npx playwright --version` before a run.

To keep the config, the specs and the report out of the consumer's git
without touching its `.gitignore`, list them in its `.git/info/exclude`,
which is local to the clone.

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
