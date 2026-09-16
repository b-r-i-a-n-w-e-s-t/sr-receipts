/**
 * The rig's type surface.
 *
 * This is the API Phase 6 publishes, so it is written for the person authoring
 * a scenario in another repo rather than for the harness. Two things here earn
 * their keep beyond documentation:
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

/** The result of running one check against a transcript. */
export interface CheckResult {
  name: string;
  pattern: string;
  count: number;
  ok: boolean;
  failures: string[];
  matchedLabels: string[];
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

/**
 * One thing to do: a target, and the question to ask it.
 *
 * Deliberately the shape a queue line parses to *and* the shape the Phase 4
 * daemon will accept over HTTP, so the queue file and the host-side client stay
 * one code path.
 */
export interface RunRequest {
  /** A fixture file name resolved under `fixtures/`, or an http(s) URL. */
  target: string;
  /** A name in `scenarios/`, or a path to a scenario file. */
  scenario: string;
}

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

export interface FailedExpectation {
  label: string;
  spec: StepSpec | StepAction;
  failures: string[];
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

export type SnapshotStatus = "new" | "match" | "differs";

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

/* ------------------------------------------------------------------ results */

/** What CI reads. One entry per run request. */
export interface RunResult {
  target: string;
  scenario: string;
  ok: boolean;
  reasons: string[];
  openedOk: boolean;
  provenance: string;
  transcript: string;
  steps: number;
  silentSteps: number;
  erroredSteps: number;
  failedExpectations: FailedExpectation[];
  checks: CheckResult[];
  snapshot: { status: SnapshotStatus | "not compared"; differences: number };
  /** What had the foreground instead, when focus was lost mid-run. */
  focusLost: string | null;
}

/** `runs/<runId>/results.json`. */
export interface RunReport {
  runId: string;
  finishedAt: string;
  ok: boolean;
  /** Non-null when the run itself broke, rather than a request failing. */
  broke: string | null;
  updatedSnapshots: boolean;
  total: number;
  failed: number;
  results: RunResult[];
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

/* ------------------------------------------------------------------- events */

/**
 * Progress from a run in flight.
 *
 * `RunStepsOptions.log` is a pre-formatted string sink — the right shape for
 * `smoke.ts` and `probe.ts`, which print it and nothing else, and the wrong one
 * for a wire, where the host wants the label and the announcement apart. So the
 * run layer emits these instead, and the daemon serialises one per line.
 *
 * `request-started` and `opened` exist to bracket a silence rather than to
 * report a result: `openTarget` spends between 17 and 45 seconds launching the
 * browser and running the guards without emitting anything, and a host watching
 * a stream cannot otherwise tell a slow open from a hung one.
 */
export type RunEvent =
  | { type: "run-started"; runId: string; total: number }
  | { type: "request-started"; index: number; target: string; scenario: string }
  /** The guards finished. `lines` is the transcript prose; when `ok` is false it is the diagnosis. */
  | { type: "opened"; target: string; ok: boolean; lines: string[] }
  | { type: "step"; target: string; index: number; label: string; spec: string; heard: string }
  | { type: "focus-lost"; target: string; after: number; thief: string }
  | { type: "snapshot"; target: string; status: SnapshotStatus; written: boolean }
  | { type: "request-finished"; target: string; result: RunResult }
  /** The run itself broke, rather than a request failing. Exit code 2, not 1. */
  | { type: "broke"; message: string }
  | { type: "run-finished"; report: RunReport };

/* ------------------------------------------------------------------- daemon */

/**
 * What `POST /runs` accepts.
 *
 * `queue` is the text of a queue file, parsed with the same `parseQueue` the
 * runner uses, so a host that already has a queue file does not have to
 * reimplement `<target> :: <scenario>` to send it. Exactly one of `requests`
 * and `queue` is required.
 */
export interface DaemonRunBody {
  /**
   * `scenario` is optional per request only when the body carries the
   * `scenario` override that will fill it in — the daemon rejects a request
   * that would otherwise have no question to ask.
   */
  requests?: Array<{ target: string; scenario?: string }>;
  queue?: string;
  /** Overrides the scenario on every request, as `runner.ts --scenario` does. */
  scenario?: string;
  updateSnapshots?: boolean;
}

/** `GET /health`. `busy` is the one thing a host needs before it posts. */
export interface DaemonHealth {
  ok: boolean;
  busy: boolean;
  /** The run in flight, when there is one. */
  runId: string | null;
  /** The environment block that heads every transcript. */
  rig: string[];
}
