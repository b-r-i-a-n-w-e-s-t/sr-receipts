# Changelog

All notable changes to `@sr-receipts/host`. Pre-1.0: a minor version may break
the contract.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig.

- `createClient`, `readFrames` and `RigError`, unchanged in behaviour.
- Owns the wire protocol in `src/protocol.ts`, which no longer depends on
  guidepup or NVDA's command names.
- **Breaking:** `FailedExpectation.spec` is a `string`. A step authored as a
  function reports `action`, the same name the `step` event already used,
  where it previously vanished from `results.json`.
