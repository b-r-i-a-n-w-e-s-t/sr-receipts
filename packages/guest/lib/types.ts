/**
 * The rig's type surface.
 *
 * Written for the person authoring a scenario in another repo rather than for
 * the harness. Two things here earn their keep beyond documentation:
 *
 * - `NvdaCommand` is derived from guidepup's own `keyboardCommands` object, so
 *   it is the exact union of the 160 command names that exist. A misspelled
 *   command used to reach `nvda.perform(undefined)`, which is silent — and a
 *   silence in a transcript is indistinguishable from a real one. `lib/steps.ts`
 *   still checks it at runtime, because a scenario can arrive as JSON from a
 *   repo that never ran tsc, but in TypeScript the typo now fails to compile,
 *   with tsc suggesting the name that was meant.
 *
 * - `Expectation` is a closed object type, so writing `contains` where
 *   `includes` was meant is a compile error rather than a runtime one.
 */
import type { nvda } from "@guidepup/guidepup";
import type { CheckResult, FailedExpectation, SnapshotStatus } from "@sr-receipts/host";

/**
 * The wire types are owned by `@sr-receipts/host`, which consumes them, and
 * re-exported here so a guest author has one place to import from.
 */
export type {
  CheckResult,
  DaemonHealth,
  DaemonRunBody,
  FailedExpectation,
  RunEvent,
  RunReport,
  RunRequest,
  RunResult,
  SnapshotStatus,
} from "@sr-receipts/host";

/** Every NVDA command guidepup exposes, as a union of literal names. */
export type NvdaCommand = keyof typeof nvda.keyboardCommands;

/**
 * What a step does. `perform` runs an NVDA command, which needs the NVDA
 * modifier that `press` cannot express; `press` sends a key combination.
 *
 * Keys are deliberately not a closed union: guidepup parses them from a string
 * grammar wide enough ("Control+Home", "ArrowDown", "Shift+Tab") that
 * enumerating it would be wrong more often than it was useful.
 */
export type StepSpec = `perform:${NvdaCommand}` | `press:${string}`;

/** The escape hatch for a step no spec can express. */
export type StepAction = () => unknown | Promise<unknown>;

/* ------------------------------------------------------------- expectations */

/**
 * What must be true of one announcement, whatever the target.
 *
 * Several matchers in one object all have to hold. Exact wording belongs in a
 * snapshot instead — an expectation naming "Historical Structures" would make
 * its scenario runnable against one fixture and nothing else.
 */
export interface Expectation {
  /** Case-insensitive substring. */
  includes?: string;
  /** Regular expression, as a string or a RegExp. Strings are case-insensitive. */
  matches?: string | RegExp;
  /** The whole announcement, exactly. */
  equals?: string;
  /** Whether this announcement is "(silence)". */
  silent?: boolean;
  /** Any of the above, negated. */
  not?: Expectation;
}

/** One expectation, or several that all have to hold. */
export type Expectations = Expectation | Expectation[];

/**
 * An assertion across the whole transcript rather than one step. This is how
 * "the detail heading is announced once, not twice" gets asked.
 */
export interface Check {
  /** Shown in the verdict, so write it as the claim being made. */
  name: string;
  /** Steps whose announcement matches this are counted. */
  matches: string | RegExp;
  equals?: number;
  atLeast?: number;
  atMost?: number;
}

/* ---------------------------------------------------------------- scenarios */

/**
 * Browser window size in pixels, for a scenario whose question only exists at a
 * particular width.
 */
export interface WindowSize {
  width: number;
  height: number;
}

/** A step as authored: object form, the form that takes repeat and settle. */
export interface AuthoredStepObject {
  /** Numbered when `repeat` is set: `{n}` is substituted, else appended. */
  label?: string;
  perform?: NvdaCommand;
  press?: string;
  /** Expand to this many steps. */
  repeat?: number;
  /** Wait this many ms before reading the speech log, for a slow step. */
  settle?: number;
  expect?: Expectations;
  /** `false` records the step without putting it in the snapshot. */
  snapshot?: boolean;
}

/**
 * A step as authored, in whichever form is clearest:
 *
 *   "perform:reportTitle"                  bare spec; the spec is the label
 *   ["title bar", "perform:reportTitle"]   tuple; the form probe.json uses
 *   { label, perform, repeat, expect }     object
 */
export type AuthoredStep =
  | StepSpec
  | readonly [label: string, spec: StepSpec]
  | AuthoredStepObject;

/** A scenario as authored. */
export interface Scenario {
  name?: string;
  description?: string;
  /**
   * How to prove browse mode on this kind of page. Defaults to table, then
   * heading, then landmark — see `lib/guard.ts`.
   */
  modeProbes?: NvdaCommand[];
  window?: WindowSize;
  steps: AuthoredStep[];
  checks?: Check[];
}

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
  name: string;
  description: string;
  modeProbes?: NvdaCommand[];
  window?: WindowSize;
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
  /** What NVDA said, one phrase per line, or "(silence)", or "ERROR ...". */
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

/** The readiness guard's outcome. */
export interface GuardResult {
  ok: boolean;
  /** One line per attempt, for the transcript. */
  seen: string[];
  /** Which mode probe answered, when one did. */
  provedBy?: NvdaCommand;
}

/**
 * The part of guidepup's NVDA the rig actually drives.
 *
 * Narrower than the real `NVDA` class on purpose, and for the same reason
 * `SpeechSource` in `lib/speech.ts` is narrow: this is the seam the unit tests
 * substitute, and a fake that has to implement thirty unused methods is a fake
 * nobody writes honestly. It also documents exactly what the rig depends on, so
 * a guidepup upgrade has a small surface to check rather than a large one.
 *
 * Declared with method syntax rather than property-arrow syntax so parameter
 * types stay bivariant and the real driver — whose `perform` takes a narrower
 * command type — remains assignable.
 */
export interface NvdaDriver {
  readonly keyboardCommands: Record<NvdaCommand, unknown>;
  perform(command: unknown): unknown;
  press(key: string): unknown;
}

/**
 * A mid-run check that keystrokes are still reaching the target.
 *
 * The focus guard runs once, before the sequence. Nothing used to re-check it,
 * so when something stole the foreground mid-run — a Windows Update restart
 * dialog, in the case that prompted this — the rig sent the rest of the
 * scenario into whatever had focus. Because NVDA's quick-navigation commands
 * are bare letters, `T` and `H` and `D` were typed in as text: one run filled
 * the Windows Search box with "ttttddddddddhhhhhhhhhhhh" and recorded 45 steps
 * of the desktop as though they were the page under test.
 */
export interface FocusWatch {
  /** Steps between checks. The last step is always checked. */
  every: number;
  /** `null` while focus is still on the target; otherwise what has it instead. */
  check(): Promise<string | null>;
}

/** What a sequence produced, and whether it got to finish. */
export interface RunStepsResult {
  steps: StepResult[];
  /**
   * Set when focus left the target mid-sequence; names what had it instead.
   * Any remaining steps were deliberately not run.
   */
  focusLost?: string;
  /** How many steps had run when focus was found to be gone. */
  focusLostAfter?: number;
}
