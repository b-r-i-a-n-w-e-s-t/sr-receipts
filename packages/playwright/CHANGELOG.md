# Changelog

All notable changes to `@sr-receipts/playwright`. Pre-1.0: a minor version may
break the contract.

## Unreleased (0.2.0)

The pivot to `page`, [ADR 0002](../../docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

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

## 0.1.0

`receiptsFixtures`: the `receipts` fixture whose `run(target, scenario)` asked
the project's reader through the guest and returned a Receipt.
