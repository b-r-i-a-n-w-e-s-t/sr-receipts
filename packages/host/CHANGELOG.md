# Changelog

All notable changes to `@sr-receipts/host`. Pre-1.0: a minor version may break
the contract.

## Unreleased (0.2.0)

The pivot to `page`, [ADR 0002](../../docs/adr/0002-playwright-drives-the-browser-and-a-reader-is-a-session.md).

- **Breaking:** the protocol is a reader session, not runs. `src/protocol.ts`
  defines `ReaderSession`, the one interface a test uses for either reader,
  `EntryPage`, `Captured`, and the daemon's routes and bodies
  (`DaemonHealth`, `EnterBody`, `EntryResult`, `Spoken`, `PhraseLog`).
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
