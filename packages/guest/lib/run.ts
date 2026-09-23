/**
 * A whole run, start to finish, as a function.
 *
 * This is everything `runner.ts` used to be except argument parsing and the
 * exit code. It moved here so the daemon and the CLI are two thin callers of
 * one implementation rather than two implementations that drift — the same
 * reason `resolveTarget` moved into `lib/target.ts` when the probe and the
 * runner turned out to be settling a fixture for different lengths of time.
 *
 * What it owns is the run's output directory: the transcripts, `results.json`,
 * the `DONE` marker and `last-run.txt`. That is deliberate. A run started over
 * HTTP has to leave `runs/<runId>/` looking exactly like one started by the
 * `nvda-run` scheduled task, or the two input paths would produce two kinds of
 * evidence and the older tooling would quietly stop finding things.
 *
 * What it does not own is printing. Progress leaves through `onEvent` as data;
 * `runner.ts` formats it for a console and the daemon serialises it to NDJSON.
 *
 * Nor does it own a screen reader. The reader is an `ExecutionTarget`, passed
 * in, and nothing here may branch on which one it is: see
 * `lib/execution-target.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareSnapshot, readSnapshot, snapshotPath, toSnapshot, writeSnapshot } from "./snapshot.ts";
import { formatTranscript, judge, toResult, wireSpec } from "./report.ts";
import { loadScenario } from "./scenario.ts";
import { SNAPSHOTS } from "./snapshot.ts";
import { slugify } from "./target.ts";
import type { ExecutionTarget, ReaderSession } from "./execution-target.ts";
import type { CompiledScenario, RunEvent, RunReport, RunRequest, RunResult } from "./types.ts";

const RIG = join(import.meta.dirname, "..");

export const RUNS = join(RIG, "runs");

/** Where a run's transcripts and `results.json` live. */
export const runDir = (runId: string): string => join(RUNS, runId);

/** Where a run leaves its evidence. Only a test has a reason to change these. */
export interface RunPaths {
  runs: string;
  snapshots: string;
  /** Holds the id of the most recent run, for tooling that watches the filesystem. */
  lastRun: string;
}

export const RUN_PATHS: RunPaths = {
  runs: RUNS,
  snapshots: SNAPSHOTS,
  lastRun: join(RIG, "last-run.txt"),
};

/**
 * Colons are legal in an ISO timestamp and not in an NTFS file name, and the
 * fractional seconds only ever made the directory harder to type.
 */
export const newRunId = (): string =>
  new Date().toISOString().replace(/:/g, "").replace(/\..+$/, "");

export interface ExecuteOptions {
  requests: RunRequest[];
  /** Accept whatever this run heard as the new baseline. */
  updateSnapshots?: boolean | undefined;
  /**
   * Progress, as it happens. Called synchronously from inside the run, so a
   * slow handler slows the run down — the daemon's writes the frame and
   * returns.
   */
  onEvent?: ((event: RunEvent) => void) | undefined;
  /** Supplied by the daemon, which has already made the directory. */
  runId?: string | undefined;
}

async function runRequest(
  target: ExecutionTarget,
  session: ReaderSession,
  request: RunRequest,
  scenario: CompiledScenario,
  outDir: string,
  snapshots: string,
  updateSnapshots: boolean,
  emit: (event: RunEvent) => void,
): Promise<RunResult> {
  const opened = await session.open(request.target, scenario);
  emit({ type: "opened", target: request.target, ok: opened.ok, lines: opened.lines });

  // A run that never reached the page has no announcements to judge, but still
  // produces a transcript — the guard diagnostics in it are the whole diagnosis.
  const { steps, focusLost, focusLostAfter } = opened.ok
    ? await session.perform(scenario, (step, index) =>
        emit({
          type: "step",
          target: request.target,
          index,
          label: step.label,
          spec: wireSpec(step.spec),
          heard: step.heard,
        }),
      )
    : { steps: [] };

  if (focusLost) {
    emit({
      type: "focus-lost",
      target: request.target,
      after: focusLostAfter ?? steps.length,
      thief: focusLost,
    });
  }

  const environment = target.environment();
  const fresh = toSnapshot({
    target: request.target,
    scenario,
    steps,
    stamp: environment,
    provenance: opened.target.provenance,
  });

  const path = snapshotPath(opened.target.slug, scenario.name, snapshots);
  // Comparing a run that never reached the page — or lost it part way — against
  // a saved snapshot would report every remaining step as removed, which buries
  // the one thing that actually went wrong. Leaving `comparison` null also stops
  // a truncated run being written out as a new baseline.
  const comparison = opened.ok && !focusLost ? compareSnapshot(fresh, readSnapshot(path)) : null;

  if (comparison) {
    const written = updateSnapshots || comparison.status === "new";
    if (written) writeSnapshot(path, fresh);
    emit({
      type: "snapshot",
      target: request.target,
      status: comparison.status,
      written,
    });
  }

  // An explicit --update-snapshots means the operator has accepted this run, so
  // differences must not also fail it.
  const judged = updateSnapshots ? null : comparison;
  const verdict = judge({ opened, scenario, steps, comparison: judged, focusLost, focusLostAfter });

  const transcriptFile = `${opened.target.slug}--${slugify(scenario.name)}.txt`;
  writeFileSync(
    join(outDir, transcriptFile),
    formatTranscript({
      request,
      scenario,
      stamp: environment,
      opened,
      steps,
      verdict,
      comparison: judged,
      focusLost,
      focusLostAfter,
      plannedSteps: scenario.steps.length,
    }),
    "utf8",
  );

  return toResult({
    request,
    scenario,
    stamp: environment,
    opened,
    steps,
    verdict,
    comparison: judged,
    focusLost,
    transcriptFile,
  });
}

/**
 * Run every request in one reader session and report.
 *
 * Never throws: a broken run is a `RunReport` with `broke` set, because the
 * caller has to write `results.json` and answer the host either way. The
 * distinction the report preserves is the one CI cares about — `broke` is an
 * unanswered question, `failed` is a wrong answer.
 */
export async function executeRun(
  target: ExecutionTarget,
  { requests, updateSnapshots = false, onEvent, runId = newRunId() }: ExecuteOptions,
  paths: RunPaths = RUN_PATHS,
): Promise<RunReport> {
  const outDir = join(paths.runs, runId);
  mkdirSync(outDir, { recursive: true });

  // A handler that throws must not take the run down with it: the run holds
  // the reader, the browser and the whole desktop, and a client that hung up
  // mid-stream is not a reason to abandon them.
  const emit = (event: RunEvent): void => {
    try {
      onEvent?.(event);
    } catch {
      // the listener's problem, not the run's
    }
  };

  const results: RunResult[] = [];
  let broke: Error | undefined;
  let session: ReaderSession | undefined;

  emit({ type: "run-started", runId, total: requests.length });

  try {
    // Load and compile every scenario before the reader starts. A typo in a
    // scenario should cost a second, not a three-minute run that ends in a
    // transcript full of silences that look exactly like real ones.
    // Keyed by the reference, or by the inline object itself. An inline
    // scenario that arrived over HTTP is a separate object in each request, so
    // it compiles once per request, which costs nothing worth saving.
    const scenarios = new Map<RunRequest["scenario"], CompiledScenario>();
    for (const { scenario } of requests) {
      if (!scenarios.has(scenario)) {
        scenarios.set(scenario, await loadScenario(scenario));
      }
    }

    // One reader session for the whole queue: same version, same settings,
    // same voice, so a diff between two targets cannot be version drift.
    session = await target.start();

    // What a reader can do is only checkable once it is up, but still before
    // the first target is opened.
    for (const scenario of scenarios.values()) {
      session.validate(scenario);
    }

    for (const [index, request] of requests.entries()) {
      const scenario = scenarios.get(request.scenario) as CompiledScenario;
      emit({
        type: "request-started",
        index,
        target: request.target,
        scenario: scenario.name,
      });
      const result = await runRequest(
        target,
        session,
        request,
        scenario,
        outDir,
        paths.snapshots,
        updateSnapshots,
        emit,
      );
      results.push(result);
      emit({ type: "request-finished", target: request.target, result });
    }
  } catch (error) {
    broke = error as Error;
    writeFileSync(
      join(outDir, "ERROR.txt"),
      `${broke?.message}\n${(broke?.cause as Error)?.message ?? broke?.cause ?? ""}\n`,
      "utf8",
    );
    emit({ type: "broke", message: broke?.message ?? String(broke) });
  } finally {
    await session?.stop();
  }

  const failed = results.filter((result) => !result.ok);
  const report: RunReport = {
    runId,
    finishedAt: new Date().toISOString(),
    ok: !broke && failed.length === 0,
    broke: broke ? (broke.message ?? String(broke)) : null,
    updatedSnapshots: updateSnapshots,
    total: results.length,
    failed: failed.length,
    results,
  };

  writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  // Still written, and still last. The host-side client awaits the stream now,
  // but the marker is what anything watching the filesystem keys off — and it
  // is the only signal a run that lost its client leaves behind.
  writeFileSync(join(outDir, "DONE"), `${new Date().toISOString()}\n`, "utf8");
  writeFileSync(paths.lastRun, `${runId}\n`, "utf8");

  emit({ type: "run-finished", report });
  return report;
}
