# Changelog

All notable changes to `@sr-receipts/guest`. Pre-1.0: a minor version may break
the contract.

## Unreleased

- The VoiceOver target starts VoiceOver with hints off
  (`SCRShouldOutputVOInstructions: false`). A hint arrived as a second phrase
  and restarted Guidepup's wait for speech to settle, so it cost 2 to 8 seconds
  on most steps for text the target then stripped. The table walk went from
  4 min 25 s to 3 min 1 s, with its snapshot unchanged. The environment stamp
  names the setting, so baselines recorded before it report a changed
  environment.
- The NVDA target reaches the desktop through `WindowsDesktop`, the way the
  VoiceOver target does through `VoiceOverDesktop`, so the focus guard, the
  browse-mode guard, the focus watch and the session lifecycle are tested
  against a fake desktop. `createNvdaTarget(desktop)` takes one; `nvdaTarget`
  is the real one. What they do on the rig is unchanged.
- The NVDA target's `validate` checks `modeProbes`, so a misspelled probe fails
  before any target opens, as the Execution Target interface promises, rather
  than when a target opens part way through a queue.
- `smoke.ts` and `probe.ts` run through `nvdaTarget`, so a passing smoke proves
  the path real runs take, and both now validate their steps and keep the
  address bar out of snapshots. A function step prints as `[action]`.
- `probe.json` as a bare array is NVDA's commands. It failed on the required
  `reader` before; `probe.example.json` names it.
- **Breaking:** `startSession`, `stopSession`, `openTarget`, `watchFocus`,
  `ensureReadyToNavigate`, `MODE_PROBES`, `NVDA_OPTIONS`, `FOCUS_CHECK_EVERY`
  and their option types are no longer exported. `runSteps` no longer takes
  `log`; `onStep` carries the same announcements.

- **Breaking:** `executeRun` takes `snapshots: "compare" | "update" | "off"`
  instead of `updateSnapshots`. With `off` a run leaves nothing in
  `snapshots/`, so a consumer's runs no longer write baselines into this
  package or fail on the ones there. The daemon refuses a mode it does not
  know with a 400. `runner.ts --update-snapshots` is unchanged.
- **Breaking:** `toResult` is now `toReceipt`, and produces the host's
  `Receipt`, which carries the environment, every step heard, and the
  transcript text. `results.json` grows by the transcript text of each request.
- A step authored as a function is printed as `[action]` in the transcript, as
  the wire already named it, rather than as the function's source.
- A request's scenario can be the scenario itself, not only a name or a path.
  `loadScenario` compiles it with `compileScenario`, the same as a file, and
  every scenario in a run is still compiled before the reader starts.
- **Breaking:** `matches` in an expectation or a check must be a string. A
  RegExp no longer compiles, and one that reaches the guest anyway, as the `{}`
  JSON turns it into, is refused when the scenario compiles. Write
  `matches: "with \\d+ rows"` for `/with \d+ rows/i`.
- The authoring types in `lib/types.ts` narrow the host's structural
  `Scenario`, so a typed scenario is a valid request body as it stands.
  `Check`, `Expectation`, `Expectations`, `Reader` and `WindowSize` are now the
  host's, re-exported.
- **Breaking:** `ReaderDriver`, `FocusWatch` and `RunStepsResult` moved to
  `lib/steps.ts`, and `GuardResult` to `lib/guard.ts`. None of them is
  exported from the package any longer.
- **Breaking:** the doctor's `Check` in `voiceover/evidence.ts` is now
  `DoctorCheck`, so the package has one `Check`.

- **Breaking:** a scenario must name its `reader`, `"nvda"` or `"voiceover"`.
  There is no default. Its steps are type-checked against that reader's
  commands, `modeProbes` is NVDA-only, and each Execution Target refuses a
  scenario written for the other reader. Add `reader: "nvda"` to existing
  scenarios.
- `voiceOverTarget` (`lib/voiceover-target.ts`) runs transcript scenarios on
  the bundled VoiceOver with Safari. `runner.ts` uses it on macOS. Before
  starting the reader it runs the doctor's checks and proves the terminal's
  Automation and Accessibility permissions, which the doctor cannot see. Each
  target opens in a Safari window of its own, closed by id. Before every step
  it has VoiceOver speak a sentinel phrase, so a silent step is recorded as
  silence and a repeated announcement is recorded whole, which Guidepup's own
  change detection cannot manage. VoiceOver's hints are stripped from recorded
  speech, because whether one is captured is a race. The environment stamp
  says both. See `voiceover/README.md` for what real runs have and have not
  established.
- The VoiceOver launch is retried up to five times, from three.
- `voiceover-table-walk` is the first VoiceOver scenario. It measures how
  repeatable VoiceOver capture is, using the rig's own snapshots.
- **Breaking:** `NvdaDriver` is now `ReaderDriver`, since Guidepup's `voiceOver`
  satisfies it too.
- A fixture's URL is built with `pathToFileURL`. Joining `file:///` to a POSIX
  path produced four slashes, which no browser reports back.
- Firefox's address bar is kept out of snapshots. It announces the target's
  location, the checkout path or the host's address, which failed every
  control-fixture baseline after the move into `packages/guest`. The committed
  baselines drop those steps; the rest of the toolbar is still compared.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig. The NVDA runtime, daemon, Provisioner and VoiceOver smoke moved under
`packages/guest` unchanged in behaviour, except as listed.

- The run layer drives an `ExecutionTarget` (`lib/execution-target.ts`) rather
  than NVDA directly. `nvdaTarget` is the NVDA implementation, and `runner.ts`
  and `daemon.ts` pass it in.
- **Breaking:** `executeRun(target, options, paths?)` replaces
  `executeRun(options)`.
- **Breaking:** the host client and wire types moved to `@sr-receipts/host`.
  The wire types are still re-exported from `lib/types.ts`.
- A run whose scenarios fail to load no longer stops NVDA and kills Firefox,
  because it never started them.
- The Provisioner runs `npm ci` and reads Guidepup from the repository root,
  where npm workspaces install them. A guest provisioned before this version
  must be re-provisioned so its scheduled tasks point at `packages/guest`.
