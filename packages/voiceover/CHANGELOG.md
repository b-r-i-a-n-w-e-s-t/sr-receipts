# Changelog

All notable changes to `@sr-receipts/voiceover`. Pre-1.0: a minor version may
break the contract.

## 0.4.0

- **`createVoiceOverSession({ stateAfterStep })`** passes the host's new
  option through, and the session has the host's `steps` and capture labels.

## 0.3.0

- **`type(text, { delay })`**, as `ReaderSession` now requires: the
  characters as System Events keystrokes, `delay` milliseconds apart, from
  one AppleScript inside Guidepup's capture, after the sentinel. Not
  Guidepup's own `type`, which waits out the speech after every key, about
  five seconds a key. Answers with VoiceOver's last phrase only: VoiceOver
  keeps no other, so the speech for earlier keys is gone by the time the
  capture reads it. Measured on 2026-10-16 (macOS 26.6.2, Playwright's
  WebKit): "ban" typed 150 ms apart arrived 151 to 164 ms apart, 4 of 4,
  and with no delay 2 to 7 ms apart, 3 of 3, each answering `n. ban`.

## 0.2.1

- **The bin path has no leading `./`,** which npm corrected, with a warning,
  on every publish.

## 0.2.0

Packaged for npm with the other three packages, [ADR 0003](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md).

- **New package,** carved out of `@sr-receipts/guest` (now
  `@sr-receipts/daemon`), whose changelog holds this code's history up to
  here. `createVoiceOverSession` is its whole import interface, and nothing
  else changed in the session.
- **Ships built JavaScript and declarations** in `dist/`, which `exports`
  points at, because Node will not strip types under `node_modules`. MIT.
- **The doctor is a bin,** `sr-voiceover-doctor`, and writes `doctor.json`
  in the directory it was run from rather than inside the package.
- **Its refusals point at this package's README** rather than a path in the
  repository.
