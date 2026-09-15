/**
 * The rig's harness. Runs one scenario per target, all targets in a single NVDA
 * session, writes one stamped transcript per target, judges the result, and
 * exits non-zero if the answer is wrong.
 *
 * Reads `queue.txt` from the rig directory: one `<target>` or
 * `<target> :: <scenario>` per line. Writes `runs/<runId>/` containing
 * `<target>--<scenario>.txt` per request, a `results.json` for CI, and a `DONE`
 * marker the host polls for.
 *
 *   node runner.cjs                                # the queue
 *   node runner.cjs --scenario survey              # override every queue line
 *   node runner.cjs "control.html :: survey"       # ad-hoc, ignoring the queue
 *   node runner.cjs a.html "b.html :: survey"      # one argument per target
 *   node runner.cjs --update-snapshots             # accept what this run heard
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
const { writeFileSync, mkdirSync, existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  startSession,
  stopSession,
  openTarget,
  parseQueue,
  loadScenario,
  validateSteps,
  runSteps,
  stamp,
  slugify,
  DEFAULT_SCENARIO,
  snapshotPath,
  toSnapshot,
  readSnapshot,
  writeSnapshot,
  compareSnapshot,
  judge,
  formatTranscript,
  toResult,
} = require("./lib/index.cjs");

const RIG = __dirname;

/**
 * `--scenario <ref>` overrides every queue line. `--update-snapshots` accepts
 * whatever this run heard as the new baseline. Remaining arguments, if any,
 * replace the queue entirely, one queue line per argument, so an ad-hoc run
 * needs no edit to a file the run will then be judged by.
 */
function parseArgs(argv) {
  const rest = [];
  let override;
  let updateSnapshots = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") {
      override = argv[++i];
      if (!override) throw new Error("--scenario needs a scenario name or path");
    } else if (argv[i] === "--update-snapshots" || argv[i] === "-u") {
      updateSnapshots = true;
    } else {
      rest.push(argv[i]);
    }
  }
  // One argument per line, so `node runner.cjs a.html "b.html :: survey"` runs
  // two targets rather than one target with a very strange name.
  return { override, updateSnapshots, inline: rest.join("\n").trim() };
}

function readQueue({ override, inline }) {
  const defaults = { defaultScenario: override ?? DEFAULT_SCENARIO };
  const queuePath = join(RIG, "queue.txt");

  const requests = inline
    ? parseQueue(inline, defaults)
    : existsSync(queuePath)
      ? parseQueue(readFileSync(queuePath, "utf8"), defaults)
      : [{ target: "control.html", scenario: defaults.defaultScenario }];

  // An explicit --scenario beats a scenario named on the line; otherwise the
  // line wins and --scenario was only supplying the default.
  return override
    ? requests.map((request) => ({ ...request, scenario: override }))
    : requests;
}

async function runRequest(nvda, speech, request, scenario, outDir, { updateSnapshots }) {
  const opened = await openTarget(speech, request.target, {
    modeProbes: scenario.modeProbes,
  });

  // A run that never reached the page has no announcements to judge, but still
  // produces a transcript — the guard diagnostics in it are the whole diagnosis.
  const steps = opened.ok
    ? await runSteps(nvda, speech, scenario.steps, {
        log: (line) => console.log(`${request.target} :: ${line}`),
      })
    : [];

  const environment = stamp();
  const fresh = toSnapshot({
    target: request.target,
    scenario,
    steps,
    stamp: environment,
    provenance: opened.target.provenance,
  });

  const path = snapshotPath(opened.target.slug, scenario.name);
  // Comparing a run that never reached the page against a saved snapshot would
  // report every step as removed, which buries the one thing that went wrong.
  const comparison = opened.ok ? compareSnapshot(fresh, readSnapshot(path)) : null;

  if (opened.ok && (updateSnapshots || comparison.status === "new")) {
    writeSnapshot(path, fresh);
    console.log(`${request.target} :: snapshot ${comparison.status === "new" ? "created" : "updated"}`);
  }

  const verdict = judge({
    opened,
    scenario,
    steps,
    // An explicit --update-snapshots means the operator has accepted this run,
    // so differences must not also fail it.
    comparison: updateSnapshots ? null : comparison,
  });

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
      comparison: updateSnapshots ? null : comparison,
    }),
    "utf8",
  );

  console.log(
    `${request.target} :: ${verdict.ok ? "PASS" : `FAIL — ${verdict.reasons.join("; ")}`}`,
  );

  return toResult({
    request,
    scenario,
    opened,
    steps,
    verdict,
    comparison: updateSnapshots ? null : comparison,
    transcriptFile,
  });
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/:/g, "").replace(/\..+$/, "");
  const outDir = join(RIG, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  const results = [];
  let broke;

  try {
    const requests = readQueue(options);

    // Load and compile every scenario before NVDA starts. A typo in a scenario
    // should cost a second, not a three-minute run that ends in a transcript
    // full of silences that look exactly like real ones.
    const scenarios = new Map();
    for (const { scenario } of requests) {
      if (!scenarios.has(scenario)) {
        scenarios.set(scenario, await loadScenario(scenario));
      }
    }

    // One NVDA session for the whole queue: same version, same settings, same
    // voice, so a diff between two targets cannot be version drift.
    const { nvda, speech } = await startSession();

    // Command names can only be checked once NVDA is up, but still before the
    // first target is opened.
    for (const scenario of scenarios.values()) {
      validateSteps(nvda, scenario.steps);
    }

    for (const request of requests) {
      results.push(
        await runRequest(nvda, speech, request, scenarios.get(request.scenario), outDir, options),
      );
    }
  } catch (error) {
    broke = error;
    writeFileSync(
      join(outDir, "ERROR.txt"),
      `${error?.message}\n${error?.cause?.message ?? error?.cause ?? ""}\n`,
      "utf8",
    );
    console.error(error?.message);
  } finally {
    await stopSession();

    const failed = results.filter((result) => !result.ok);
    writeFileSync(
      join(outDir, "results.json"),
      JSON.stringify(
        {
          runId,
          finishedAt: new Date().toISOString(),
          ok: !broke && failed.length === 0,
          broke: broke ? (broke.message ?? String(broke)) : null,
          updatedSnapshots: options.updateSnapshots,
          total: results.length,
          failed: failed.length,
          results,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    writeFileSync(join(outDir, "DONE"), `${new Date().toISOString()}\n`, "utf8");
    writeFileSync(join(RIG, "last-run.txt"), `${runId}\n`, "utf8");

    console.log(
      `\n${results.length - failed.length}/${results.length} passed — runs/${runId}`,
    );
    // 2 is "the question was not answered", 1 is "the answer was wrong". CI
    // should treat them differently: one is a broken rig, the other a finding.
    process.exitCode = broke ? 2 : failed.length ? 1 : 0;
  }
})();
