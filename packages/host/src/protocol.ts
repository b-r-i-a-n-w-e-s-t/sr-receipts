/**
 * The wire between a host and a guest daemon.
 *
 * Owned here, by the side that consumes it, and deliberately free of any screen
 * reader's vocabulary: nothing below names an NVDA command or imports guidepup.
 * The guest implements this contract and depends on this package for it; the
 * host never depends on the guest. A step's spec therefore crosses the wire as
 * the string it was authored as, which is also the only form JSON can carry.
 */

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
  /** A name in the guest's `scenarios/`, or a path to a scenario file. */
  scenario: string;
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
  | { type: "request-finished"; target: string; result: RunResult }
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
  requests?: Array<{ target: string; scenario?: string }>;
  queue?: string;
  /** Overrides the scenario on every request, as the guest's `runner.ts --scenario` does. */
  scenario?: string;
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
