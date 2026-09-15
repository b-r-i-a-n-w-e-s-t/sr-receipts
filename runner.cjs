/**
 * The rig's harness. Runs one scenario per target, all targets in a single NVDA
 * session, and writes one stamped transcript per target.
 *
 * Reads `queue.txt` from the rig directory: one `<target>` or
 * `<target> :: <scenario>` per line. Writes `runs/<runId>/<slug>.txt` plus a
 * `DONE` marker the host polls for.
 *
 *   node runner.cjs                                # the queue
 *   node runner.cjs --scenario survey              # override every queue line
 *   node runner.cjs "control.html :: survey"       # ad-hoc, ignoring the queue
 *   node runner.cjs a.html "b.html :: survey"      # one argument per target
 *
 * Quote an inline `target :: scenario`, since each argument becomes one queue
 * line.
 *
 * Must be started by the `nvda-run` scheduled task, not over plain SSH: an SSH
 * session has no interactive desktop, so NVDA has no foreground window to
 * describe.
 *
 * There is no test knowledge left in this file. What to ask a target lives in
 * `scenarios/`, or in whatever file a consuming repo points `--scenario` at.
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
} = require("./lib/index.cjs");

const RIG = __dirname;

/**
 * `--scenario <ref>` overrides every queue line. Remaining arguments, if any,
 * replace the queue entirely, one queue line per argument, so an ad-hoc run
 * needs no edit to a file the run will then be judged by.
 */
function parseArgs(argv) {
  const rest = [];
  let override;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") {
      override = argv[++i];
      if (!override) throw new Error("--scenario needs a scenario name or path");
    } else {
      rest.push(argv[i]);
    }
  }
  // One argument per line, so `node runner.cjs a.html "b.html :: survey"` runs
  // two targets rather than one target with a very strange name.
  return { override, inline: rest.join("\n").trim() };
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

async function runRequest(nvda, speech, request, scenario, outDir) {
  const opened = await openTarget(speech, request.target, {
    modeProbes: scenario.modeProbes,
  });

  const lines = [
    `# ${request.target}`,
    `scenario: ${scenario.name}${scenario.description ? ` — ${scenario.description}` : ""}`,
    "",
    ...stamp(),
    opened.target.provenance,
    `run started: ${new Date().toISOString()}`,
    "",
    ...opened.lines,
  ];

  if (opened.ok) {
    await runSteps(nvda, speech, scenario.steps, {
      lines,
      log: (line) => console.log(`${request.target} :: ${line}`),
    });
  }

  // Named for both, because a run is a scenario against a target and a queue may
  // legitimately ask the same target two different questions. Naming it for the
  // target alone let the second transcript silently overwrite the first.
  const file = `${opened.target.slug}--${slugify(scenario.name)}.txt`;
  writeFileSync(join(outDir, file), lines.join("\n"), "utf8");
}

(async () => {
  const requests = readQueue(parseArgs(process.argv.slice(2)));

  const runId = new Date().toISOString().replace(/:/g, "").replace(/\..+$/, "");
  const outDir = join(RIG, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  try {
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
      await runRequest(nvda, speech, request, scenarios.get(request.scenario), outDir);
    }
  } catch (error) {
    writeFileSync(
      join(outDir, "ERROR.txt"),
      `${error?.message}\n${error?.cause?.message ?? error?.cause ?? ""}\n`,
      "utf8",
    );
    console.error(error?.message);
    process.exitCode = 1;
  } finally {
    await stopSession();
    writeFileSync(join(outDir, "DONE"), `${new Date().toISOString()}\n`, "utf8");
    writeFileSync(join(RIG, "last-run.txt"), `${runId}\n`, "utf8");
  }
})();
