# sr-receipts

Receipts for what a screen reader actually said. sr-receipts lets the
Playwright tests of the app you are working on drive a real screen reader,
NVDA or VoiceOver, beside Playwright's own `page`, and keeps every word the
reader said as evidence, stamped with the exact reader, browser and operating
system that produced it.

## Why

Most accessibility testing inspects the page: axe reads the DOM, and a
simulated screen reader walks the accessibility tree and guesses what a reader
would say. Both are fast, and both miss the class of bug that only exists in
the reader. NVDA and VoiceOver each flatten, merge, skip and re-order what the
browser gives them, and they do it differently, and differently again from one
release to the next.

A **Receipt** is the answer to "what did the screen reader say?" from the
screen reader itself: the transcript of every call and its answer, the
environment that explains it, and Playwright's own report and trace of what
the page was doing. A simulated reader never produces one. It is what a ticket
cites instead of a screen recording of someone driving a screen reader.

That matters most for questions a DOM check cannot answer, such as:

- Does an expandable table row's detail announce as belonging to its row, or as
  a stranger in the table? Is it read once, or twice?
- When a row is selected through the page, does the status region's "1 row
  selected" reach the reader?
- Did a component library upgrade, or a browser upgrade, change how a widget is
  announced? And if it did, which of the two changed?

The first consumer is `@txstate-mws/carbon-svelte`, but nothing here knows about
it. Any web app Playwright can open can be pointed at, and the tests live in
the consuming repo.

## How it works

```
 The Mac you develop on                        Windows Guest Rig (UTM VM, yours)
 ─────────────────────                        ──────────────────────────────────

 npx playwright test --project nvda            guest daemon (at logon)
   page  ── connectOptions (ws) ─────────▶       Playwright browser server: Edge
   reader ── HTTP + token ───────────────▶       NVDA, the guards, capture

 npx playwright test --project voiceover
   page  ── Playwright's WebKit or Chrome, on this Mac
   reader ── VoiceOver, in process, on this Mac
```

One spec serves both projects. A test gets `page` from Playwright and `reader`
from the fixture, and never says which reader it has:

```ts
test('selecting a row is announced', async ({ page, reader }) => {
  await page.goto('/demo/columnlist')
  await reader.enter(page)
  const { spoken } = await reader.capture(() => page.getByLabel('select row').first().click())
  expect(spoken).toMatch(/1 row selected/)
  expect(await reader.next()).toMatch(/column 2/)
})
```

Three packages:

| Package | Owns | Runs on |
|---|---|---|
| [`@sr-receipts/host`](packages/host/README.md) | The `ReaderSession` interface a test uses, the wire to a guest daemon, and NVDA as a session over it. Knows no reader's commands. | The Mac you develop on |
| [`@sr-receipts/guest`](packages/guest/README.md) | The daemon that serves NVDA and launches the browser server, the guards, the VoiceOver session, the smoke, and the Provisioner for the Windows Guest Rig | The guest, and the Mac for VoiceOver |
| [`@sr-receipts/playwright`](packages/playwright/README.md) | The `reader` fixture, so a consuming repo drives a real reader from its own `playwright test`. Depends on the host. | The Mac you develop on |

The guest depends on the host for the protocol, never the other way round. All
three are private workspace packages, versioned and changelogged separately,
and not published. Why it is shaped this way, what it cost, and what was
retired to get here are in
[ADR 0002](docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

### The life of a test

1. **The reader starts.** VoiceOver in process, with its launch retried on the
   known race; NVDA through the daemon, fresh for each test.
2. **`reader.enter(page)` proves the reader is on the page.** On NVDA: the
   browser is in front, focus is in the document, and browse mode is on, each
   shown by behaviour rather than assumed, because every expensive mistake on
   the rig was a guard that certified a run it should have failed. On
   VoiceOver: the Item Chooser sequence returns and the first item has text.
   An entry that fails throws with every attempt in the message.
3. **The test asks.** Reader commands by Guidepup's names, key presses, and
   `reader.capture(action)` for what a `page` action makes the reader say.
   Playwright's `expect` judges the answers.
4. **The Receipt is attached.** The transcript and the environment stamp go on
   the test, beside Playwright's report and trace.

## Using it

- **From a consuming repo's Playwright tests.** The `reader` fixture in
  `@sr-receipts/playwright`, with a `voiceover` project and an `nvda`
  project. See [`packages/playwright/README.md`](packages/playwright/README.md).
- **Against NVDA**, the guest daemon has to be up. It starts at logon once
  the rig is provisioned; see
  [`docs/operating-the-rig.md`](docs/operating-the-rig.md).
- **Against VoiceOver**, `playwright test` has to be launched from the
  application holding the macOS grants in
  [`packages/guest/voiceover/README.md`](packages/guest/voiceover/README.md),
  and it takes over the Mac while it runs.

## Where to read next

| To | Read |
|---|---|
| Drive a reader from a consuming repo's Playwright tests | [`packages/playwright/README.md`](packages/playwright/README.md) |
| Set up and run the Windows Guest Rig | [`docs/operating-the-rig.md`](docs/operating-the-rig.md) |
| Run VoiceOver on a Mac, and what is known about capturing it | [`packages/guest/voiceover/README.md`](packages/guest/voiceover/README.md) |
| Understand the guards and the daemon's routes | [`packages/guest/README.md`](packages/guest/README.md) |
| Call the daemon from code | [`packages/host/README.md`](packages/host/README.md) |
| Provision a new Windows Guest Rig | [`packages/guest/provisioning/README.md`](packages/guest/provisioning/README.md) |
| See what is planned and why | [`docs/roadmap.md`](docs/roadmap.md), [`docs/adr/`](docs/adr/) |
| Look up a term | [`CONTEXT.md`](CONTEXT.md) |

## Working in the repository

```bash
npm ci      # at the repository root: installs every package from one lockfile
npm test    # every package's tests, then a typecheck of the whole repository
```

`npm test` needs no screen reader. Real-reader runs happen from a consuming
repo's Playwright tests, and the guest's smoke from the guest.
