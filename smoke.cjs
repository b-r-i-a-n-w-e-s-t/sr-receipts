/**
 * The rig's smoke test: does NVDA start, reach a document, and answer a quick
 * navigation command on this machine right now?
 *
 * This is the only check that exercises the guards, the Firefox launch and the
 * NVDA lifecycle for real — `npm test` deliberately covers only the parts that
 * need no desktop. Run it after touching anything in `lib/`.
 *
 *   node smoke.cjs [target]
 *
 * `target` is a fixture name or a URL, defaulting to `control.html`.
 *
 * Triggering it over plain SSH does not work: the run has to be started by the
 * `nvda-smoke` scheduled task, registered with `/it` so it lands in the
 * logged-in console session.
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  startSession,
  stopSession,
  openTarget,
  runSteps,
  stamp,
} = require("./lib/index.cjs");

/**
 * Kept inline rather than moved to `scenarios/`, deliberately. The smoke test
 * has to be able to say "the rig itself is fine" when a scenario is broken, so
 * it must not depend on scenario loading.
 */
const STEPS = [
  ["title bar (NVDA+T)", "perform:reportTitle"],
  ["current focus (NVDA+Tab)", "perform:reportCurrentFocus"],
  ["next table (T)", "perform:moveToNextTable"],
  ["next table again (T)", "perform:moveToNextTable"],
];

(async () => {
  const target = process.argv[2] ?? "control.html";
  const out = [`# smoke on ${target}`, "", ...stamp(), ""];
  let ok = false;

  try {
    const { nvda, speech } = await startSession();
    const opened = await openTarget(speech, target);
    out.push(opened.target.provenance, "", ...opened.lines);

    if (opened.ok) {
      await runSteps(nvda, speech, STEPS, {
        lines: out,
        log: (line) => console.log(line),
      });
      ok = true;
    }
  } catch (error) {
    console.error("FAILED:", error?.message);
    console.error("CAUSE:", error?.cause?.message ?? error?.cause ?? "(none)");
    out.push("### error", error?.message ?? "", error?.cause?.message ?? "");
  } finally {
    writeFileSync(join(__dirname, "smoke-log.txt"), out.join("\n") + "\n", "utf8");
    await stopSession();
    console.log(ok ? "\nSMOKE OK" : "\nSMOKE FAILED — see smoke-log.txt");
    process.exitCode = ok ? 0 : 1;
  }
})();
