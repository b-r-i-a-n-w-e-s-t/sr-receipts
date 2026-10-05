# Changelog

All notable changes to `@sr-receipts/host`. Pre-1.0: a minor version may break
the contract.

## Unreleased

- **`ReaderSession.type(text, { delay })`**, with `TypeOptions`: the
  characters of a text as keys, `delay` milliseconds apart, inside one speech
  window, answering with everything said. `press` waits out the speech after
  each key, so nothing could ask what a reader says at typing speed.
  `ReaderAdapter` gains `type(text, options)`, which every adapter has to
  implement.
- **The wire is at protocol 2.** `POST /reader/type` takes `TypeBody`,
  `{ text, delay? }`, and answers `Spoken`. A host at 2 refuses a daemon at 1
  when it starts, and the reverse.

## 0.2.1

- No changes; released with the other three packages.

## 0.2.0

Packaged for npm with the other three packages, [ADR 0003](../../docs/adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md).

- **Ships built JavaScript and declarations** in `dist/`, which `exports`
  points at, because Node will not strip types under `node_modules`. MIT.
- **The wire has a version.** `PROTOCOL_VERSION`, bumped by hand when a
  route or a body changes shape. `DaemonHealth` carries the daemon's as
  `protocol`, and `createNvdaSession`'s `start` refuses a daemon reporting
  another, or none, naming both, before the reader starts.

The pivot to `page`, [ADR 0002](../../docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

- **Breaking:** the protocol is a reader session, not runs. `src/protocol.ts`
  defines `ReaderSession`, the one interface a test uses for either reader,
  `EntryPage`, `Captured`, and the daemon's routes and bodies
  (`DaemonHealth`, `EnterBody`, `EntryResult`, `Spoken`, `PhraseLog`).
  `EntryResult` is `{ ok: true, arrivedOn, lines }` or
  `{ ok: false, lines, error }`: what the guards recorded either way, and
  a failure's cause chain, so `createNvdaSession` records the lines and
  throws the reason without parsing prose.
  `GET /desktop/windows` and `POST /desktop/activate`, with `Windows` and
  `Activation`, were part of this and are gone again: nothing on the Mac
  called them.
  `Scenario`, `RunRequest`, `RunReport`, `Receipt`, `RunEvent`,
  `DaemonRunBody` and the NDJSON stream are gone.
- **Breaking:** `createClient` and `readFrames` are replaced by
  `createNvdaSession`, NVDA as a `ReaderSession` over the wire with the
  transcript kept on the Mac. `RigError` stays.
- `createReaderSession(adapter)`, with `ReaderAdapter` and `Recorder`: the
  Reader Session both readers are built with. It keeps the transcript, a line
  for a failed call included, serializes calls, turns a synchronous throw into
  a rejection, refuses a reader call from inside a capture's action rather
  than deadlocking, restarts on `start`, and never waits or throws on `stop`.
- `errorChain`, an error and its causes as transcript text.
- `SILENCE`, what a transcript records for a silent call, moved here from
  the guest.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig: `createClient`, `readFrames` and `RigError`, and the wire protocol in
`src/protocol.ts`.
