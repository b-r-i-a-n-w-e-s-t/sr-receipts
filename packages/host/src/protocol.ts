/**
 * The wire between a host and a guest daemon.
 *
 * Owned here, by the side that consumes it, and deliberately free of any screen
 * reader's commands: nothing below names an NVDA or VoiceOver command or imports
 * guidepup. The readers themselves are named, because a scenario has to say
 * whose commands its steps are. The guest implements this contract and depends
 * on this package for it; the host never depends on the guest. A step's spec
 * therefore crosses the wire as the string it was authored as, which is also the
 * only form JSON can carry.
 */

/* ---------------------------------------------------------------- scenarios */

/*
 * The structural shape of a scenario: everything in it is plain JSON, so it
 * crosses the wire unchanged. The guest's `lib/types.ts` narrows it, checking
 * each step's command against its reader's own command names, and documents
 * what every field means.
 */

/** Each reader a scenario can be written for. */
export type Reader = "nvda" | "voiceover";

/**
 * Browser window size in pixels, for a scenario whose question only exists at a
 * particular width.
 */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * What must be true of one announcement, whatever the target.
 *
 * Several matchers in one object all have to hold. Exact wording belongs in a
 * snapshot instead: an expectation naming "Historical Structures" would make
 * its scenario runnable against one fixture and nothing else.
 */
export interface Expectation {
  /** Case-insensitive substring. */
  includes?: string;
  /**
   * Regular expression source, matched case-insensitively. A string rather than
   * a RegExp, because a RegExp serialises to `{}` and would cross the wire as a
   * pattern that matches the wrong thing without saying so.
   */
  matches?: string;
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
  /** Steps whose announcement matches this regular expression source are counted. */
  matches: string;
  equals?: number;
  atLeast?: number;
  atMost?: number;
}

/** A step as authored: object form, the form that takes repeat and settle. */
export interface AuthoredStepObject {
  /** Numbered when `repeat` is set: `{n}` is substituted, else appended. */
  label?: string;
  perform?: string;
  press?: string;
  /** Expand to this many steps. */
  repeat?: number;
  /** Wait this many ms before reading the speech log, for a slow step. */
  settle?: number;
  expect?: Expectations;
  /** `false` records the step without putting it in the snapshot. */
  snapshot?: boolean;
}

/** A bare `perform:x` or `press:y` spec, a `[label, spec]` tuple, or an object. */
export type AuthoredStep = string | readonly [label: string, spec: string] | AuthoredStepObject;

/** A scenario as authored, in the form that can cross the wire. */
export interface Scenario {
  reader: Reader;
  name?: string;
  description?: string;
  /** NVDA only. */
  modeProbes?: string[];
  window?: WindowSize;
  /**
   * How often, in steps, to re-check that the keystrokes are still reaching the
   * page. Defaults to the Execution Target's own interval.
   *
   * Detection happens *after* a step, so up to this many keystrokes can reach a
   * window that stole the foreground. That is harmless for navigation keys, and
   * it is not harmless for a scenario that sends activating keys: an `Enter`
   * into somebody else's window presses whatever it finds. Such a scenario says
   * so here.
   */
  focusCheckEvery?: number;
  steps: AuthoredStep[];
  checks?: Check[];
}

/* --------------------------------------------------------------------- runs */

/**
 * One thing to do: a target, and the question to ask it.
 *
 * Deliberately the shape a queue line parses to *and* the shape the daemon
 * accepts over HTTP, so the queue file and the host-side client stay one code
 * path.
 */
export interface RunRequest {
  /** A fixture file name resolved under the guest's `fixtures/`, or an http(s) URL. */
  target: string;
  /**
   * A name in the guest's `scenarios/`, a path to a scenario file, or the
   * scenario itself. All three compile the same way, before the reader starts.
   */
  scenario: string | Scenario;
}

export type SnapshotStatus = "new" | "match" | "differs";

/** The result of running one check against a transcript. */
export interface CheckResult {
  name: string;
  pattern: string;
  count: number;
  ok: boolean;
  failures: string[];
  matchedLabels: string[];
}

/** A step whose expectation did not hold. */
export interface FailedExpectation {
  label: string;
  /** The step as authored, e.g. `perform:moveToNextTable`; `action` for a function step. */
  spec: string;
  failures: string[];
}

/** One step, as the reader answered it. */
export interface HeardStep {
  label: string;
  /** The step as authored, e.g. `perform:moveToNextTable`; `action` for a function step. */
  spec: string;
  /** What the reader said, one phrase per line, or "(silence)", or "ERROR ...". */
  heard: string;
}

/**
 * What one request to a real screen reader produced: the verdict, the
 * transcript, the environment that explains it, and what was heard at each
 * step. One per run request, and complete on its own, so a caller never has
 * to fetch the transcript or the environment separately to have the evidence.
 */
export interface Receipt {
  target: string;
  scenario: string;
  ok: boolean;
  reasons: string[];
  openedOk: boolean;
  provenance: string;
  /** The Execution Target's environment block, which heads the transcript. */
  environment: string[];
  /** The transcript, and the name it has in the run's directory on the guest. */
  transcript: { file: string; text: string };
  /** Every step that ran, in order, including those kept out of the snapshot. */
  heard: HeardStep[];
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
  results: Receipt[];
}

/**
 * Progress from a run in flight.
 *
 * `request-started` and `opened` exist to bracket a silence rather than to
 * report a result: opening a target spends between 17 and 45 seconds launching
 * the browser and running the guards without emitting anything, and a host
 * watching a stream cannot otherwise tell a slow open from a hung one.
 */
export type RunEvent =
  | { type: "run-started"; runId: string; total: number }
  | { type: "request-started"; index: number; target: string; scenario: string }
  /** The guards finished. `lines` is the transcript prose; when `ok` is false it is the diagnosis. */
  | { type: "opened"; target: string; ok: boolean; lines: string[] }
  | { type: "step"; target: string; index: number; label: string; spec: string; heard: string }
  | { type: "focus-lost"; target: string; after: number; thief: string }
  | { type: "snapshot"; target: string; status: SnapshotStatus; written: boolean }
  | { type: "request-finished"; target: string; result: Receipt }
  /** The run itself broke, rather than a request failing. Exit code 2, not 1. */
  | { type: "broke"; message: string }
  | { type: "run-finished"; report: RunReport };

/**
 * What `POST /runs` accepts.
 *
 * `queue` is the text of a queue file, parsed on the guest with the same parser
 * its runner uses, so a host that already has a queue file does not have to
 * reimplement `<target> :: <scenario>` to send it. Exactly one of `requests`
 * and `queue` is required.
 */
export interface DaemonRunBody {
  /**
   * `scenario` is optional per request only when the body carries the
   * `scenario` override that will fill it in. The daemon rejects a request
   * that would otherwise have no question to ask.
   */
  requests?: Array<{ target: string; scenario?: string | Scenario }>;
  queue?: string;
  /** Overrides the scenario on every request, as the guest's `runner.ts --scenario` does. */
  scenario?: string | Scenario;
  updateSnapshots?: boolean;
}

/** `GET /health`. `busy` is the one thing a host needs before it posts. */
export interface DaemonHealth {
  ok: boolean;
  busy: boolean;
  /** The run in flight, when there is one. */
  runId: string | null;
  /** The Execution Target's environment block, which heads every transcript. */
  rig: string[];
}
