# Changelog

All notable changes to `@sr-receipts/playwright`. Pre-1.0: a minor version may
break the contract.

## 0.4.0

- **The fixture writes a Receipt File** for every test that ran a reader:
  `<spec>-receipts/<describe and test titles>--<project>.md` beside the spec,
  replaced by the next run. The header, the environment stamp, a table of
  the Steps and the whole transcript; no timestamp, so the file changes only
  when the run did. A skipped test leaves the last one. See the README's
  "Reading a receipt".
- **`test.use({ receipt: { state } })`**: page state read after each Step,
  a column each in the Receipt File.
- **The `reader` fixture now depends on `page`**, to read `receipt.state`.
- **`capture(action, { label })`** and **`reader.steps`**, through
  `@sr-receipts/host`.
- **The skill's recording template is gone**: `references/record-spec.ts`
  did by hand what the fixture now does. The skill's method reads Receipt
  Files, and its page log becomes a `receipt.state` column.
- **Fixed: a guest on another Playwright minor failed as a WebSocket error.**
  Playwright refuses a client of another major.minor at connect, with an
  error that names neither fix and prints the rig token. A worker-scoped
  preflight now reads the guest's stamp before the browser connects, and
  fails with both versions and both fixes. An unreachable daemon fails there
  too, named.

## 0.3.0

- **`reader.type(text, { delay })`**, through `@sr-receipts/host`: what the
  reader says while a text is typed at a set pace. See the README's session
  list.
- **Fixed: a reader that never started left no receipt.** The fixture
  started the session before the `try` that attaches the transcript and the
  environment stamp, so a failed start attached neither, and the record of
  every start attempt was lost with them. A failed start now leaves both.
- **Ships the `sr-receipts` agent skill** in `skills/`: the method for
  settling a screen reader question with receipts, and a recording spec to
  start from. `npx skills add ./node_modules/@sr-receipts/playwright`
  installs it; see the README.

## 0.2.1

- No changes; released with the other three packages.

## 0.2.0

Packaged for npm with the other three packages, [ADR 0003](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md).

- **Ships built JavaScript and declarations** in `dist/`, which `exports`
  points at, because Node will not strip types under `node_modules`. MIT.
- **Breaking:** the optional peer for a VoiceOver project is
  `@sr-receipts/voiceover`, not `@sr-receipts/guest`, and the error for a
  missing one names it. The fixture's declarations no longer reference the
  peer's types, so an NVDA-only consumer typechecks without it installed.

The pivot to `page`, [ADR 0002](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

- **Breaking:** `receiptsFixtures` and the `receipts` fixture are replaced by
  `readerFixtures` and the `reader` fixture: a `ReaderSession` beside
  Playwright's own `page`, configured by `use: { readerOptions }`. An NVDA
  project gets `page` from the guest's browser server through
  `connectOptions`, and the reader through the daemon; a VoiceOver project
  runs in process through `@sr-receipts/guest`, still an optional peer.
- **Breaking:** `run(target, scenario)`, budgets, the derived timeout and the
  verdict are gone. A test is code against `page` and `reader`, judged by
  Playwright's `expect`; its timeout is the consumer's.
- Each test attaches `reader-transcript` and `environment`. The stamp names
  the browser once: the guest's Edge for NVDA, and for VoiceOver the browser
  Playwright launched, with its version.
- `@playwright/test` `^1.63.0` is the peer range, since a consumer's version
  must match the guest's browser server.
- `readerMatchers`, for the consumer's `expect.extend`: `toAnnounce(text)`
  matches literal text case-insensitively, across any whitespace and never
  inside a longer word, or takes a RegExp; `toAnnounceCleanly()` fails on a
  symbol read as a word, an ellipsis, or a period standing alone. Both take a
  spoken string or a `capture`'s `{ spoken }`.
- `withReader(base)` returns the consumer's `test` with the `reader` fixture,
  typed. Playwright's `extend` cannot infer fixture types, so
  `base.extend(readerFixtures)` ran but left `reader` untyped in a consumer's
  editor and `tsc`. `readerFixtures` is still exported.
- Either reader's session now serializes calls, so a spec's `Promise.all`
  over two reader calls runs them in order, and a reader call from inside a
  `capture`'s action is refused rather than hanging the test.

## 0.1.0

`receiptsFixtures`: the `receipts` fixture whose `run(target, scenario)` asked
the project's reader through the guest and returned a Receipt.
