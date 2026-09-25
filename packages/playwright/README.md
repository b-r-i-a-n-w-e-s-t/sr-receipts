# @sr-receipts/playwright

A `receipts` fixture for Playwright Test, so a consuming repo can ask a real
screen reader from its own `playwright test` and get back a Receipt.

Playwright is the runner, reporter and configuration here, never the browser
driver: there is no `page`. The reader, its real browser, the guards and the
verdict stay on the guest, behind the Execution Target seam. Why, and what was
given up for it, is in
[ADR 0001](../../docs/adr/0001-playwright-is-the-runner-not-the-browser-driver.md).

NVDA only, for now. The VoiceOver project is the next step on the
[roadmap](../../docs/roadmap.md).

## Ownership

This package owns:

- `receiptsFixtures`, the `receipts` fixture and its `receiptsOptions`
- what happens around a run: the timeout derived from the scenario, joining a
  path target to `baseURL`, refusing a scenario written for the other reader,
  the attachments, and turning a FAIL verdict into a failed test

It depends on `@sr-receipts/host` for the client and the protocol, and imports
only types from `@playwright/test`, which is a peer dependency.

## Use

Extend the consumer's own `test`. The package exports fixtures rather than a
`test`, because a linked package would otherwise load a second copy of
Playwright, which Playwright refuses to run with.

```ts
// receipts/combobox.nvda.spec.ts
import { test as base } from '@playwright/test'
import { receiptsFixtures } from '@sr-receipts/playwright'

const test = base.extend(receiptsFixtures)

test('the combo box echoes typed characters', async ({ receipts }) => {
  await receipts.run('/demo/96', {
    reader: 'nvda',
    name: 'combobox-echo',
    steps: [
      { label: 'to the combo box', perform: 'moveToNextComboBox' },
      { label: 'enter focus mode', press: 'Enter' },
      { label: 'type a', press: 'a', expect: { matches: '(^|\\. )a(\\.|$)' } },
    ],
  })
})
```

Give it a config of its own, so the repo's ordinary `playwright test` never
asks for the rig, and a test directory the ordinary config does not match:

```ts
// playwright.receipts.config.ts
import { defineConfig } from '@playwright/test'
import type { ReceiptsOptions } from '@sr-receipts/playwright'

export default defineConfig<{}, { receiptsOptions: ReceiptsOptions }>({
  testDir: 'receipts',
  workers: 1,
  retries: 0,
  projects: [{
    name: 'nvda',
    testMatch: /\.nvda\.spec\.ts$/,
    use: {
      receiptsOptions: {
        reader: 'nvda',
        url: process.env.RIG_URL ?? '',
        token: process.env.RIG_TOKEN ?? '',
        baseURL: 'http://192.168.64.1:5176',
      },
    },
  }],
})
```

- **`workers: 1` and `retries: 0` are required.** One reader holds one desktop,
  so a second worker gets a busy rig. A retry that turns a finding green
  destroys the evidence.
- **`baseURL` is the Mac as the guest sees it**, and the dev server has to
  listen on that interface (`vite dev --host 0.0.0.0`), not only on
  `localhost`. A target that is already a URL is passed through unchanged.
- **`RIG_URL` and `RIG_TOKEN`** are the guest daemon's; see
  [`docs/operating-the-rig.md`](../../docs/operating-the-rig.md).

`receipts.run(target, scenario)` runs one scenario against one target, with
the guest's own snapshots off, and returns the Receipt:

- **FAIL** fails the test and lists every failed expectation and check. Pass
  `{ assert: false }` to get the Receipt whatever its verdict, for an
  investigation that wants the transcript.
- **A broken run** throws, and so does a busy rig, naming the run in flight
  rather than waiting for it.
- **A scenario for the other reader** throws before anything opens.

The test's timeout is set from the scenario: an open budget, plus a step budget
for each step, plus every `settle`. The defaults are in `defaultBudgets`, and
`receiptsOptions.budgets` overrides them per project. Each test attaches the
transcript, the environment stamp and the Receipt as JSON to the report.

Scenarios are written exactly as in
[`docs/scenarios.md`](../../docs/scenarios.md), as objects in the spec. Only
the object form is accepted, because the timeout is derived from it.

## Linking it into a consumer

Until the package is published, link it without saving, so the consumer's
`package.json` and lockfile stay untouched:

```bash
npm install --no-save file:/path/to/sr-receipts/packages/playwright
```

The link is a symlink, and Playwright compiles the linked TypeScript because
its real path is outside `node_modules`.

## Versioning

Pre-1.0 semantic versioning: a minor version may break the contract, and says
so in [`CHANGELOG.md`](CHANGELOG.md). Private to this repository until it is
published.

## Tests

```bash
npm test
```

What the fixture does around a run is tested here without Playwright or a rig.
The fixture against a real reader is run from a consumer.
