# @sr-receipts/playwright

A `reader` fixture for Playwright Test, so a consuming repo drives a real
screen reader beside Playwright's own `page` from its own `playwright test`.

Playwright drives the browser. For a VoiceOver project that is the browser
Playwright launched on this Mac; for an NVDA project it is the guest's Edge,
reached through Playwright's own `connectOptions`. The reader comes from the
fixture: VoiceOver in process, NVDA through the guest daemon. Both are the
same `ReaderSession`, so a spec never says which one it has. Why, and what was
given up for it, is in
[ADR 0002](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

## Installing it in a consumer

```bash
npm install --save-dev @sr-receipts/playwright @playwright/test@1.63
npm install --save-dev @sr-receipts/voiceover    # only for a voiceover project
```

The consumer's `@playwright/test` must share the guest's major.minor, which is
the Runtime Manifest's Playwright version. An NVDA project checks this before
its browser connects, and names both versions when they differ: an `npm up`
that moves Playwright's minor is the usual cause. An NVDA project also needs a
Windows Guest Rig on the same release of sr-receipts; see
[`docs/operating-the-rig.md`](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/operating-the-rig.md). A VoiceOver
project needs the macOS grants in
[`@sr-receipts/voiceover`'s README](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/packages/voiceover/README.md).

### The agent skill

This package ships `sr-receipts`, an [agent skill](https://agentskills.io)
that teaches a coding agent the method for settling a screen reader question
with receipts: variants and a control, one test before the matrix, repeated
runs before a finding is reported, and the gotchas of reading speech. Install
it from the package, so the skill always matches the API beside it:

```bash
npx skills add ./node_modules/@sr-receipts/playwright -a claude-code
```

That copies it into the project's `.claude/skills/`; add `-g` for every
project, or drop `-a` to choose among the agents the
[`skills`](https://github.com/vercel-labs/skills) CLI supports. Run it again
after upgrading this package.

## Configuring it

Give the receipts a config of their own, so the repo's ordinary `playwright
test` never asks for a reader, and a test directory the ordinary config does
not match:

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
- **`timeout`** is the consumer's to set. An NVDA entry costs about 28
  seconds, a VoiceOver entry 15 to 25, a captured page action 1.5 seconds on
  NVDA and 5 on VoiceOver; 240 seconds covers a test of a dozen steps.
- **`baseURL` is wherever the reader's browser reaches the app.** For NVDA
  that is the Mac as the guest sees it, and the dev server has to listen on
  that interface (`--host 0.0.0.0` for Vite, or your server's equivalent),
  not only on `localhost`. For VoiceOver the browser runs on the Mac, so it
  is `localhost`.
- **`RIG_URL`, `RIG_BROWSER` and `RIG_TOKEN`** are the guest daemon's, for the
  NVDA project only; see
  [`docs/operating-the-rig.md`](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/operating-the-rig.md). The config
  above reads them from `.env.rig`; sourcing that file in the shell works too.
- **`webServer` listens on every interface** for the NVDA project's sake, and
  `reuseExistingServer` lets a dev server you already started serve both
  projects.
- **`reporter` writes its own report folder**, apart from the ordinary
  config's. Passing `--reporter` on the command line replaces both reporters,
  so no HTML report is written and the folder keeps the previous run's.
- **The VoiceOver project's browser is whatever Playwright launched.**
  `readerOptions.applicationName` overrides the name VoiceOver activates,
  which defaults from the project's `browserName` and `channel`.

To try receipts in a repo without committing them, list the config, the test
directory and the report folder in its `.git/info/exclude`, which is local to
the clone and leaves `.gitignore` alone.

## Writing a test

Pass the consumer's own `test` to `withReader`, and extend the consumer's own
`expect` with `readerMatchers`. A linked or duplicated package would otherwise
load a second copy of Playwright, which Playwright refuses to run with.

```ts
// receipts/row-selection.spec.ts
import { test as base, expect as baseExpect } from '@playwright/test'
import { readerMatchers, withReader } from '@sr-receipts/playwright'

const test = withReader(base)
const expect = baseExpect.extend(readerMatchers)

test('selecting a row through the page is announced', async ({ page, reader }) => {
  expect((await page.goto('/orders'))?.ok()).toBe(true)
  await reader.enter(page)

  const checkbox = page.getByRole('checkbox', { name: 'Select row' }).first()
  const selected = await reader.capture(() => checkbox.check())
  expect.soft(selected).toAnnounce('1 row selected')
  expect.soft(selected).toAnnounceCleanly()

  // Neither reader follows a click, but both follow page focus.
  await reader.capture(() => checkbox.focus())
  expect.soft(await reader.next()).toAnnounce('column 2')
})
```

Run it with `npx playwright test --config playwright.receipts.config.ts`,
adding `--project nvda` or `--project voiceover` for one reader. A VoiceOver
test takes over the Mac's keyboard and speech while it runs, and has to be
launched from the app holding the grants; run `npx sr-voiceover-doctor`
first.

- **Check that the page loaded before entering it.** The reader's entry
  succeeds on a 404 page, which has content like any other, and the next
  locator then waits out the whole test timeout. The `ok()` line above turns
  four minutes into a clear failure.
- **Move the reader with `locator.focus()` inside a `capture`**, not with a
  click.
- **Use `expect.soft`** for a test with several findings, so the first one
  does not hide the rest.
- **Put what you will filter on in the title.** `--grep` and `--grep-invert`
  match test titles, not what a test does, so a path or issue number that
  appears only inside the test body selects nothing. Check a filter with
  `--list` before a long run.

### The reader

The `reader` fixture starts a fresh reader for each test and stops it after.
What it offers:

- **`enter(page, { modeProbes? })`** puts the reader on the page's content and
  proves it. On NVDA it is the rig's guards, and a page with no table,
  heading or landmark passes its own `modeProbes`. It throws with every
  attempt in the message when the proof fails.
- **`perform(command)`, `press(key)`, `next()`, `previous()`** return what the
  reader said, `""` for silence. Commands are Guidepup's names.
- **`type(text, { delay })`** types the text into whatever has focus, a key
  per character, and returns everything the reader said from the first key
  until the speech after the last one ended. `press` waits out the speech
  after each key, about a second on NVDA, so a string of presses is slow
  typing; `type` is for what a reader does at the pace of someone's hands.
  `delay` is the milliseconds between keys, 0 when left out, as in
  Playwright's `keyboard.type`. On NVDA the gap is the delay plus what Windows
  takes to send a key, so read the real spacing from the page's own
  `keydown` times when it matters. VoiceOver answers with its last phrase
  only, because it keeps no other: the speech for the keys before it is
  gone.
- **`capture(action, { label? })`** runs a `page` action inside the reader's
  speech window and returns `{ result, spoken }`. The label names the action
  in the transcript and the Receipt File, "page action" when left out. The
  action must not call the reader; such a call is refused rather than left
  waiting for the capture it is inside.
- **Calls run one at a time**, in the order they were made, on either reader,
  so a `Promise.all` over two reader calls never interleaves keystrokes.
  Every call rejects rather than throws, and a failed one leaves a line in
  the transcript.
- **`transcript`** is every call and its answer. The fixture attaches it to
  the test as `reader-transcript`, with the environment stamp as
  `environment`, whatever the outcome, so a passing test in the HTML report
  carries them too, and so does a test whose reader never started.
- **`steps`** is each call the test made, structured: `call`, then `spoken`
  or `error`, then the page state read after it. The transcript without
  start, entry and stop. The Receipt File's rows.

To keep page state beside each Step, declare what to read in the spec:

```ts
test.use({
  receipt: {
    state: () => ({
      'Focused after': document.activeElement?.textContent?.trim() ?? '(none)',
      'Expanded after': document.querySelector('[aria-haspopup]')?.getAttribute('aria-expanded') ?? '(absent)',
    }),
  },
})
```

`state` runs in the page after every Step, before the next call, and each
key becomes a column. It goes inside `receipt` because Playwright takes a
function given to `test.use` directly as that option's fixture, and runs it
in Node; the types do not catch it. It is sent to the page as source, so it
cannot use the spec's variables. Values other than strings are written as
JSON. A read that throws, such as on a page that has navigated away, is
named in that Step's row and fails nothing.

Keys a reader must hear go through the reader. `page.keyboard` injects into
the browser below the operating system's input queue, so NVDA neither echoes
nor intercepts those keys.

### The matchers

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

## Reading a receipt

Each test that ran a reader writes a **Receipt File** beside its spec, the
way Playwright keeps snapshots:

```
receipts/row-selection.spec.ts-receipts/selecting-a-row-through-the-page-is-announced--nvda.md
```

One per test per project, named from its `describe` titles and its own,
and replaced by the test's next run. It holds the test's title, reader,
outcome (with the retry, if it was one) and spec line; the environment
stamp; a table of the Steps, what the reader said at each, and any
`receipt.state` columns; and the whole transcript, with the entry's proof at
its top. A skipped test leaves the last file alone.

Nothing in it changes unless the run did: there is no timestamp or
duration. Committed, a change in what the reader said shows in `git diff`;
a project that does not want them committed ignores `*.spec.ts-receipts/`.
A renamed or deleted test leaves its old file behind, to delete by hand.
Titles become file names the way Playwright's snapshot names do: every run
of characters other than ASCII letters and digits becomes one `-`. Two tests
whose titles differ only there, such as `describe('a b') > test('c')` and
`test('a b c')`, share a file, and the later one silently replaces the
other.

The same receipt is two attachments on each test in the HTML report, passed
or failed: `reader-transcript` and `environment`, what produced the speech.
Open the report from the consumer repo:

```bash
npx playwright show-report receipts-report
```

Click a test, then scroll to its **Attachments**, where both are expandable
text.

- **Each run replaces the report.** It holds the latest run only, and a
  `--project nvda` run leaves only NVDA's tests in it. The Receipt Files
  are the copy to cite.
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

## Ownership

This package owns `withReader` and `readerFixtures`, the `reader` fixture and
its `readerOptions`, the speech matchers, the agent skill, and what happens
around a test: starting and stopping the session, attaching the transcript
and the environment stamp, and writing the Receipt File.

It depends on `@sr-receipts/host` for the interface and the NVDA session, and
imports only types from `@playwright/test`, which is a peer dependency.
`@sr-receipts/voiceover` is an optional peer, loaded only when a VoiceOver
project runs, so an NVDA-only consumer never installs Guidepup.

`withReader` takes the consumer's `test` as an argument rather than this
package exporting one, so only the consumer's Playwright is loaded. It also
names the fixture types for the type checker: Playwright's `extend` cannot
infer them, so `base.extend(readerFixtures)` runs but leaves `reader`
untyped. `readerFixtures` stays exported for a consumer composing its own
fixtures, with the type arguments written out.

## Trying an unreleased change

To run a consumer against this repository's working tree, install tarballs
without saving, so the consumer's `package.json` and lockfile stay untouched.
In this repository:

```bash
npm run build
mkdir -p /tmp/sr-receipts
for p in host playwright voiceover; do (cd packages/$p && npm pack --pack-destination /tmp/sr-receipts); done
```

and in the consumer, every tarball in one command, so each finds the others:

```bash
npm install --no-save @playwright/test@1.63 /tmp/sr-receipts/sr-receipts-*.tgz
```

Any later `npm ci` or `npm install` in the consumer undoes an unsaved
install, so check `npx playwright --version` before a run. An NVDA project
also needs the guest on the same change; see "Upgrading the guest" in
[`docs/operating-the-rig.md`](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/operating-the-rig.md).

## Versioning

Pre-1.0 semantic versioning: a minor version may break the contract, and says
so in [`CHANGELOG.md`](CHANGELOG.md). Released with the other three packages,
always at the same version.

## Tests

```bash
npm test
```

What the fixture decides before a reader starts, and the Receipt File it
writes after, are tested here without Playwright or a reader. The fixture
against a real reader is run from a consumer.
