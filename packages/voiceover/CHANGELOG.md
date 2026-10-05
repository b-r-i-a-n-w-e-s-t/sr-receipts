# Changelog

All notable changes to `@sr-receipts/voiceover`. Pre-1.0: a minor version may
break the contract.

## 0.2.1

- **The bin path has no leading `./`,** which npm corrected, with a warning,
  on every publish.

## 0.2.0

Packaged for npm with the other three packages, [ADR 0003](../../docs/adr/0003-four-published-packages-and-the-daemon-installs-from-npm.md).

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
