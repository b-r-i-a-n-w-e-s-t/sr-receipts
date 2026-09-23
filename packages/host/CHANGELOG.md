# Changelog

All notable changes to `@sr-receipts/host`. Pre-1.0: a minor version may break
the contract.

## Unreleased (0.2.0)

- **Breaking:** `updateSnapshots: boolean` is replaced by `snapshots:
  "compare" | "update" | "off"`, in `DaemonRunBody` and in the client's
  `RunOptions`, defaulting to `compare`. `off` neither reads nor writes the
  guest's own baselines, for a host that keeps its baselines elsewhere.
  `RunReport.updatedSnapshots` is `RunReport.snapshots`, the mode the run used.
- **Breaking:** `RunResult` is now `Receipt`, the glossary's name for what one
  request to a real screen reader produced. It carries the evidence itself:
  `environment`, the stamp that heads the transcript; `heard`, every step's
  label, spec and announcement; and `transcript`, now `{ file, text }` rather
  than a file name. A host no longer needs `transcript()` or `health()` to
  have a request's evidence.
- The protocol owns the structural `Scenario` type and its parts: `Reader`,
  `WindowSize`, `Expectation`, `Expectations`, `Check`, `AuthoredStep` and
  `AuthoredStepObject`. Everything in it is plain JSON. The protocol names the
  readers but still none of their commands.
- `RunRequest.scenario`, and the per-request and override `scenario` in
  `DaemonRunBody`, accept a `Scenario` as well as a name or path, so a host can
  send a scenario it never wrote to a file.
- **Breaking:** `Expectation.matches` and `Check.matches` are strings of
  regular expression source, always case-insensitive. A RegExp serialises to
  `{}`, which would have crossed the wire as a pattern that matches the wrong
  thing.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig.

- `createClient`, `readFrames` and `RigError`, unchanged in behaviour.
- Owns the wire protocol in `src/protocol.ts`, which no longer depends on
  guidepup or NVDA's command names.
- **Breaking:** `FailedExpectation.spec` is a `string`. A step authored as a
  function reports `action`, the same name the `step` event already used,
  where it previously vanished from `results.json`.
