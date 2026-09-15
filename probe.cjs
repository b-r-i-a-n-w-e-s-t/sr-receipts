/**
 * Fast iteration tool for working out key sequences before committing them to a
 * scenario. Reads `probe.json`, a list of `[label, "perform:<command>"]` or
 * `[label, "press:<key>"]` pairs, and `probe-fixture.txt` naming the target.
 * Writes `probe-out.txt`.
 *
 * The target is either a fixture file name, resolved under `fixtures\`, or an
 * `http`/`https` URL passed through unchanged. The URL form is how the live docs
 * page on the host's dev server gets probed.
 *
 * This and `runner.cjs` now share one harness, so a sequence that works here
 * behaves the same in the run meant to confirm it. They used to carry separate
 * copies of the focus guard and separate settle timings.
 *
 * Started by the `nvda-probe` scheduled task.
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  startSession,
  stopSession,
  openTarget,
  compileScenario,
  runSteps,
  windowList,
} = require("./lib/index.cjs");

const RIG = __dirname;

/**
 * `probe.json` is either a bare array of `["label", "perform:x"]` tuples — the
 * form it has always had — or a whole scenario object, which is how a probe gets
 * at `repeat` and `modeProbes` without being promoted to a file in `scenarios/`
 * first. Both compile to the same thing.
 */
function readProbe(raw) {
  const parsed = JSON.parse(raw);
  return compileScenario(
    Array.isArray(parsed) ? { name: "probe", steps: parsed } : parsed,
    "probe.json",
  );
}

(async () => {
  const target = readFileSync(join(RIG, "probe-fixture.txt"), "utf8").trim();
  const scenario = readProbe(readFileSync(join(RIG, "probe.json"), "utf8"));
  const out = [`# probe on ${target}`, `# scenario: ${scenario.name}`, ""];

  try {
    const { nvda, speech } = await startSession();

    const opened = await openTarget(speech, target, {
      modeProbes: scenario.modeProbes,
    });
    out.push(`# url: ${opened.target.url}`, opened.target.provenance, "");

    // What is actually on the screen, rather than what we assume is.
    out.push("### windows on screen", windowList(), "");
    out.push(...opened.lines);

    if (!opened.ok) {
      out.push(
        "Never reached a state where quick navigation works, so every step",
        "below would be a meaningless silence. Steps not run.",
        "",
      );
    } else {
      await runSteps(nvda, speech, scenario.steps, {
        lines: out,
        log: (line) => console.log(line),
      });
    }
  } catch (error) {
    out.push("### fatal", `${error?.message} / ${error?.cause?.message ?? ""}`);
  } finally {
    writeFileSync(join(RIG, "probe-out.txt"), out.join("\n") + "\n", "utf8");
    await stopSession();
    writeFileSync(join(RIG, "probe-done.txt"), new Date().toISOString(), "utf8");
  }
})();
