/**
 * The rig's command line. Reads a queue, runs it, prints it, exits.
 *
 * The run itself lives in `lib/run.ts`, which the daemon calls too — this file
 * is argument parsing, console formatting and an exit code, and nothing else.
 *
 * Reads `queue.txt` from the rig directory: one `<target>` or
 * `<target> :: <scenario>` per line. Writes `runs/<runId>/` containing
 * `<target>--<scenario>.txt` per request, a `results.json` for CI, and a `DONE`
 * marker the host polls for.
 *
 *   node runner.ts                                # the queue
 *   node runner.ts --scenario survey              # override every queue line
 *   node runner.ts "control.html :: survey"       # ad-hoc, ignoring the queue
 *   node runner.ts a.html "b.html :: survey"      # one argument per target
 *   node runner.ts --update-snapshots             # accept what this run heard
 *
 * Quote an inline `target :: scenario`, since each argument becomes one queue
 * line.
 *
 * Exit codes: 0 all requests passed, 1 at least one failed, 2 the run itself
 * broke (NVDA would not start, a scenario would not load). The distinction
 * matters to CI: 1 is a result, 2 is an unanswered question.
 *
 * Must be started by the `nvda-run` scheduled task, not over plain SSH: an SSH
 * session has no interactive desktop, so NVDA has no foreground window to
 * describe.
 *
 * There is no test knowledge left in this file. What to ask a target lives in
 * `scenarios/`, and what its answer should be lives there and in `snapshots/`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SCENARIO,
  executeRun,
  parseQueue,
  type RunEvent,
  type RunRequest,
} from "./lib/index.ts";

const RIG = import.meta.dirname;

interface Options {
  override?: string;
  updateSnapshots: boolean;
  inline: string;
}

/**
 * `--scenario <ref>` overrides every queue line. `--update-snapshots` accepts
 * whatever this run heard as the new baseline. Remaining arguments, if any,
 * replace the queue entirely, one queue line per argument, so an ad-hoc run
 * needs no edit to a file the run will then be judged by.
 */
function parseArgs(argv: string[]): Options {
  const rest: string[] = [];
  let override: string | undefined;
  let updateSnapshots = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") {
      override = argv[++i];
      if (!override) throw new Error("--scenario needs a scenario name or path");
    } else if (argv[i] === "--update-snapshots" || argv[i] === "-u") {
      updateSnapshots = true;
    } else {
      rest.push(argv[i] as string);
    }
  }
  // One argument per line, so `node runner.ts a.html "b.html :: survey"` runs
  // two targets rather than one target with a very strange name.
  return { ...(override !== undefined && { override }), updateSnapshots, inline: rest.join("\n").trim() };
}

function readQueue({ override, inline }: Options): RunRequest[] {
  const defaults = { defaultScenario: override ?? DEFAULT_SCENARIO };
  const queuePath = join(RIG, "queue.txt");

  const requests = inline
    ? parseQueue(inline, defaults)
    : existsSync(queuePath)
      ? parseQueue(readFileSync(queuePath, "utf8"), defaults)
      : [{ target: "control.html", scenario: defaults.defaultScenario }];

  // An explicit --scenario beats a scenario named on the line; otherwise the
  // line wins and --scenario was only supplying the default.
  return override ? requests.map((request) => ({ ...request, scenario: override })) : requests;
}

/**
 * The console's share of a run, prefixing everything with the target so a queue
 * of several reads as several. This is the formatting the run layer no longer
 * does, reproduced line for line.
 */
function print(event: RunEvent): void {
  switch (event.type) {
    case "step":
      console.log(
        `${event.target} :: ${event.label} [${event.spec}] :: ${event.heard.replace(/\n/g, " / ")}`,
      );
      break;
    case "focus-lost":
      console.log(`${event.target} :: FOCUS LOST after step ${event.after}: ${event.thief}`);
      break;
    case "snapshot":
      if (event.written) {
        console.log(
          `${event.target} :: snapshot ${event.status === "new" ? "created" : "updated"}`,
        );
      }
      break;
    case "request-finished": {
      const { ok, reasons } = event.result;
      console.log(`${event.target} :: ${ok ? "PASS" : `FAIL — ${reasons.join("; ")}`}`);
      break;
    }
    case "broke":
      console.error(event.message);
      break;
    case "run-finished": {
      const { total, failed, runId } = event.report;
      console.log(`\n${total - failed}/${total} passed — runs/${runId}`);
      break;
    }
  }
}

const options = parseArgs(process.argv.slice(2));

let requests: RunRequest[];
try {
  requests = readQueue(options);
} catch (error) {
  // A queue that will not parse never reaches the run layer, so there is no
  // runs/<runId>/ to explain it. Exit 2: the question was not asked.
  console.error((error as Error).message);
  process.exit(2);
}

const report = await executeRun({
  requests,
  updateSnapshots: options.updateSnapshots,
  onEvent: print,
});

// 2 is "the question was not answered", 1 is "the answer was wrong". CI
// should treat them differently: one is a broken rig, the other a finding.
process.exitCode = report.broke ? 2 : report.failed ? 1 : 0;
