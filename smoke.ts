/**
 * The rig's smoke test: does NVDA start, reach a document, and answer a quick
 * navigation command on this machine right now?
 *
 * This is the only check that exercises the guards, the Firefox launch and the
 * NVDA lifecycle for real — `npm test` deliberately covers only the parts that
 * need no desktop. Run it after touching anything in `lib/`.
 *
 *   node smoke.ts [target]
 *
 * `target` is a fixture name or a URL, defaulting to `control.html`.
 *
 * Triggering it over plain SSH does not work: the run has to be started by the
 * `nvda-smoke` scheduled task, registered with `/it` so it lands in the
 * logged-in console session.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SILENCE,
  openTarget,
  runSteps,
  stamp,
  startSession,
  stopSession,
  type CompiledStep,
} from "./lib/index.ts";

/**
 * Kept inline rather than moved to `scenarios/`, deliberately. The smoke test
 * has to be able to say "the rig itself is fine" when a scenario is broken, so
 * it must not depend on scenario loading.
 */
const STEPS: CompiledStep[] = [
  { label: "title bar (NVDA+T)", spec: "perform:reportTitle" },
  { label: "current focus (NVDA+Tab)", spec: "perform:reportCurrentFocus" },
  { label: "next table (T)", spec: "perform:moveToNextTable" },
  { label: "next table again (T)", spec: "perform:moveToNextTable" },
];

const target = process.argv[2] ?? "control.html";
const out = [`# smoke on ${target}`, "", ...stamp(), ""];
let ok = false;

try {
  const { nvda, speech } = await startSession();
  const opened = await openTarget(speech, target);
  out.push(opened.target.provenance, "", ...opened.lines);

  if (opened.ok) {
    const steps = await runSteps(nvda, speech, STEPS, {
      log: (line) => console.log(line),
    });
    for (const step of steps) {
      out.push(`### ${step.label} [${String(step.spec)}]`, step.heard, "");
    }
    // The smoke test asserts only that the rig works: NVDA started, the page
    // was reached, and quick navigation answered. What it answered *with* is
    // the runner's business.
    ok = steps.every((step) => !step.error) && steps.some((step) => step.heard !== SILENCE);
  }
} catch (error) {
  const failure = error as Error;
  console.error("FAILED:", failure?.message);
  console.error("CAUSE:", (failure?.cause as Error)?.message ?? failure?.cause ?? "(none)");
  out.push("### error", failure?.message ?? "", (failure?.cause as Error)?.message ?? "");
} finally {
  writeFileSync(join(import.meta.dirname, "smoke-log.txt"), out.join("\n") + "\n", "utf8");
  await stopSession();
  console.log(ok ? "\nSMOKE OK" : "\nSMOKE FAILED — see smoke-log.txt");
  process.exitCode = ok ? 0 : 1;
}
