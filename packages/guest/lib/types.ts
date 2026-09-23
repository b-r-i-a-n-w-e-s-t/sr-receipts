/**
 * The rig's type surface.
 *
 * Written for the person authoring a scenario in another repo rather than for
 * the harness. Two things here earn their keep beyond documentation:
 *
 * - `NvdaCommand` and `VoiceOverCommand` are derived from guidepup's own
 *   `keyboardCommands` objects, so each is the exact union of the command names
 *   that exist for that reader. A misspelled command used to reach
 *   `nvda.perform(undefined)`, which is silent — and a silence in a transcript
 *   is indistinguishable from a real one. `lib/steps.ts` still checks it at
 *   runtime, because a scenario can arrive as JSON from a repo that never ran
 *   tsc, but in TypeScript the typo now fails to compile, with tsc suggesting
 *   the name that was meant.
 *
 * - A scenario names its `reader`, and its steps are checked against that
 *   reader's commands. The two vocabularies share 17 names out of several
 *   hundred and the readers navigate differently — NVDA by flat quick
 *   navigation, VoiceOver by interacting with a container and moving inside it
 *   — so a scenario is written for one reader, in the commands its users press.
 *
 * - `Expectation` is a closed object type, so writing `contains` where
 *   `includes` was meant is a compile error rather than a runtime one.
 */
import type { nvda, voiceOver } from "@guidepup/guidepup";
import type {
  AuthoredStepObject as WireStepObject,
  Check,
  CheckResult,
  Expectations,
  FailedExpectation,
  Reader,
  Scenario as WireScenario,
  SnapshotStatus,
  WindowSize,
} from "@sr-receipts/host";

/**
 * The wire types are owned by `@sr-receipts/host`, which consumes them, and
 * re-exported here so a guest author has one place to import from. The parts
 * of a scenario that do not depend on a reader's commands are among them.
 */
export type {
  Check,
  CheckResult,
  DaemonHealth,
  DaemonRunBody,
  Expectation,
  Expectations,
  FailedExpectation,
  Reader,
  RunEvent,
  RunReport,
  RunRequest,
  RunResult,
  SnapshotStatus,
  WindowSize,
} from "@sr-receipts/host";

/** Every NVDA command guidepup exposes, as a union of literal names. */
export type NvdaCommand = keyof typeof nvda.keyboardCommands;

/** Every VoiceOver keyboard command guidepup exposes, the same way. */
export type VoiceOverCommand = keyof typeof voiceOver.keyboardCommands;

/** Each reader a scenario can be written for, and the commands it answers to. */
export interface ReaderCommands {
  nvda: NvdaCommand;
  voiceover: VoiceOverCommand;
}

/**
 * What a step does. `perform` runs one of the reader's own commands, which
 * needs the reader's modifier that `press` cannot express; `press` sends a key
 * combination.
 *
 * Keys are deliberately not a closed union: guidepup parses them from a string
 * grammar wide enough ("Control+Home", "ArrowDown", "Shift+Tab") that
 * enumerating it would be wrong more often than it was useful.
 */
export type StepSpec<R extends Reader = Reader> =
  | `perform:${ReaderCommands[R]}`
  | `press:${string}`;

/** The escape hatch for a step no spec can express. */
export type StepAction = () => unknown | Promise<unknown>;

/* ---------------------------------------------------------------- scenarios */

/*
 * The typed forms below narrow the host's structural `Scenario`: each is
 * assignable to it, so a scenario written against these types can be sent to a
 * daemon unchanged. What they add is the check that every command is one the
 * scenario's reader has.
 */

/** A step as authored: object form, the form that takes repeat and settle. */
export interface AuthoredStepObject<R extends Reader = Reader> extends Omit<WireStepObject, "perform"> {
  perform?: ReaderCommands[R];
}

/**
 * A step as authored, in whichever form is clearest:
 *
 *   "perform:reportTitle"                  bare spec; the spec is the label
 *   ["title bar", "perform:reportTitle"]   tuple; the form probe.json uses
 *   { label, perform, repeat, expect }     object
 */
export type AuthoredStep<R extends Reader = Reader> =
  | StepSpec<R>
  | readonly [label: string, spec: StepSpec<R>]
  | AuthoredStepObject<R>;

/** What every scenario says, whichever reader it is written for. */
interface ScenarioFor<R extends Reader> extends Omit<WireScenario, "reader" | "modeProbes" | "steps"> {
  /**
   * The reader whose commands the steps are written in. Required: an Execution
   * Target refuses a scenario written for another reader before it opens
   * anything.
   */
  reader: R;
  steps: AuthoredStep<R>[];
}

export interface NvdaScenario extends ScenarioFor<"nvda"> {
  /**
   * How to prove browse mode on this kind of page. Defaults to table, then
   * heading, then landmark — see `lib/guard.ts`. VoiceOver has no browse mode,
   * so only an NVDA scenario can say this.
   */
  modeProbes?: NvdaCommand[];
}

export type VoiceOverScenario = ScenarioFor<"voiceover">;

/** A scenario as authored. */
export type Scenario = NvdaScenario | VoiceOverScenario;

/** One step after compilation: repeats expanded, labels numbered. */
export interface CompiledStep {
  label: string;
  spec: StepSpec | StepAction;
  settle?: number;
  expect?: Expectations;
  snapshot?: boolean;
}

/** A scenario after compilation. Defaults are resolved; `steps` is flat. */
export interface CompiledScenario {
  reader: Reader;
  name: string;
  description: string;
  /** Only ever set for an NVDA scenario. */
  modeProbes?: NvdaCommand[];
  window?: WindowSize;
  focusCheckEvery?: number;
  steps: CompiledStep[];
  checks: Check[];
}

/* --------------------------------------------------------------------- runs */

/** Where to point the browser, and what exactly is under test. */
export interface ResolvedTarget {
  url: string;
  /** Git blob hash for a fixture; a note that a URL has no local bytes. */
  provenance: string;
  settle: number;
  /** Filename-safe form, used for transcripts and snapshots. */
  slug: string;
}

/** What one step produced. */
export interface StepResult {
  label: string;
  spec: StepSpec | StepAction;
  /** What the reader said, one phrase per line, or "(silence)", or "ERROR ...". */
  heard: string;
  error?: string;
  expect?: Expectations;
  snapshot?: boolean;
}

/** How the focus and browse-mode guards went. */
export interface OpenResult {
  ok: boolean;
  /** Transcript prose. When `ok` is false, this is the entire diagnosis. */
  lines: string[];
  target: ResolvedTarget;
}

/** Whether the run answered correctly, and if not, why. */
export interface Verdict {
  ok: boolean;
  reasons: string[];
  assertions: FailedExpectation[];
  checks: CheckResult[];
  snapshot: SnapshotStatus | "not compared";
}

/* ---------------------------------------------------------------- snapshots */

/** One recorded announcement. The only thing a snapshot compares. */
export interface SnapshotStep {
  label: string;
  heard: string;
}

/**
 * A committed transcript. `recordedWith` and `provenance` ride along for
 * context when a diff needs explaining, and are not compared.
 */
export interface Snapshot {
  target: string;
  scenario: string;
  provenance: string;
  recordedWith: string[];
  recordedAt: string;
  steps: SnapshotStep[];
}

export type SnapshotDifference =
  | { kind: "changed"; label: string; was: string; now: string }
  | { kind: "added"; label: string; now: string }
  | { kind: "removed"; label: string; was: string };

export interface SnapshotComparison {
  status: SnapshotStatus;
  differences: SnapshotDifference[];
  /** Both are reasons a diff may be legitimate rather than a regression. */
  environmentChanged?: boolean;
  provenanceChanged?: boolean;
  savedEnvironment?: string[];
  savedProvenance?: string;
}
