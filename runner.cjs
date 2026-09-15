/**
 * The rig's harness. Runs one key sequence per target, all targets in a single
 * NVDA session, and writes one stamped transcript per target.
 *
 * Reads `queue.txt` (one target per line) from the rig directory. Writes
 * `runs/<runId>/<slug>.txt` plus a `DONE` marker the host polls for.
 *
 * Must be started by the `nvda-run` scheduled task, not over plain SSH: an SSH
 * session has no interactive desktop, so NVDA has no foreground window to
 * describe.
 *
 * Everything that was hard to get right — the focus and browse-mode guards, the
 * hermetic Firefox profile, the settle timings, reading the speech log without
 * dropping phrases — now lives in `lib/`. What is left here is this rig's
 * current question, in `sequence()`.
 */
const { writeFileSync, mkdirSync, existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  startSession,
  stopSession,
  openTarget,
  parseQueue,
  runSteps,
  stamp,
} = require("./lib/index.cjs");

const RIG = __dirname;

/**
 * Mirrors the protocol's checks so the transcript maps onto its ledger:
 * table framing and quick nav, cell navigation across a row and down a column,
 * a line read-through to catch double announcement of the detail, and Tab to
 * test whether controls inside the detail are reachable.
 *
 * Phase 2 moves this out of the harness and into a scenario file the consuming
 * repo owns. Until then it is still welded to the column-list investigation.
 */
function sequence() {
  const steps = [
    ["title bar", "perform:reportTitle"],
    ["focus and mode", "perform:reportCurrentFocus"],
    ["T table framing", "perform:moveToNextTable"],
    ["T again", "perform:moveToNextTable"],
    ["shift+T back", "perform:moveToPreviousTable"],
    // T lands the caret on the table's name or caption, which is inside the
    // table but not in a cell, and cell navigation refuses to move from there.
    // One ArrowDown enters row 1 column 1. Proven on control.html.
    ["arrow down to enter the table", "press:ArrowDown"],
    ["ctrl+alt+down to first data row", "perform:moveToNextRow"],
  ];

  // Walk the whole data row. G exposes 10 columns, 05 exposes 9, so 11 moves
  // run off the end in both and the boundary announcement is itself evidence.
  for (let i = 1; i <= 11; i++) {
    steps.push([`ctrl+alt+right, move ${i}`, "perform:moveToNextColumn"]);
  }
  for (let i = 1; i <= 3; i++) {
    steps.push([`ctrl+alt+down, row +${i}`, "perform:moveToNextRow"]);
  }
  steps.push(["ctrl+alt+left, back one cell", "perform:moveToPreviousColumn"]);

  // Read-through from the table start, which is where double announcement of
  // the detail (name then content) would show up.
  steps.push(["ctrl+home to top", "press:Control+Home"]);
  steps.push(["T table framing, repeat", "perform:moveToNextTable"]);
  for (let i = 1; i <= 30; i++) {
    steps.push([`arrow down, line ${i}`, "press:ArrowDown"]);
  }

  // Tab from inside the expanded detail: are its controls reachable?
  for (let i = 1; i <= 8; i++) {
    steps.push([`tab ${i}`, "press:Tab"]);
  }

  return steps;
}

async function runTarget(nvda, speech, entry, outDir) {
  const opened = await openTarget(speech, entry);
  const lines = [
    `# ${entry}`,
    "",
    ...stamp(),
    opened.target.provenance,
    `run started: ${new Date().toISOString()}`,
    "",
    ...opened.lines,
  ];

  if (opened.ok) {
    await runSteps(nvda, speech, sequence(), {
      lines,
      log: (line) => console.log(`${entry} :: ${line}`),
    });
  }

  writeFileSync(join(outDir, `${opened.target.slug}.txt`), lines.join("\n"), "utf8");
}

(async () => {
  const queuePath = join(RIG, "queue.txt");
  const queue = existsSync(queuePath)
    ? parseQueue(readFileSync(queuePath, "utf8"))
    : ["control.html"];

  const runId = new Date().toISOString().replace(/:/g, "").replace(/\..+$/, "");
  const outDir = join(RIG, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  try {
    // One NVDA session for the whole queue: same version, same settings, same
    // voice, so a diff between two targets cannot be version drift.
    const { nvda, speech } = await startSession();
    for (const entry of queue) {
      await runTarget(nvda, speech, entry, outDir);
    }
  } catch (error) {
    writeFileSync(
      join(outDir, "ERROR.txt"),
      `${error?.message}\n${error?.cause?.message ?? error?.cause ?? ""}\n`,
      "utf8",
    );
  } finally {
    await stopSession();
    writeFileSync(join(outDir, "DONE"), `${new Date().toISOString()}\n`, "utf8");
    writeFileSync(join(RIG, "last-run.txt"), `${runId}\n`, "utf8");
  }
})();
