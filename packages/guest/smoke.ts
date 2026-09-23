/**
 * The rig's smoke test: does NVDA start, reach a document, and answer a quick
 * navigation command on this machine right now?
 *
 * This is the only check that exercises the guards, the Firefox launch and the
 * NVDA lifecycle for real. `npm test` covers their sequencing against a fake
 * desktop, and nothing that needs a real one. Run it after touching anything in
 * `lib/`.
 *
 *   node smoke.ts [target]
 *
 * `target` is a fixture name or a URL, defaulting to `control.html`.
 *
 * Triggering it over plain SSH does not work: the run has to be started by the
 * `nvda-smoke` scheduled task, registered with `/it` so it lands in the
 * logged-in console session.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SILENCE,
  nvdaTarget,
  wireSpec,
  type CompiledScenario,
  type CompiledStep,
  type ReaderSession,
} from "./lib/index.ts";
import {
  SMOKE_CONTROL_FIXTURE,
  SMOKE_RESULT_SCHEMA_VERSION,
  type SmokeRequest,
  type SmokeResult,
} from "./lib/smoke-result.ts";

/**
 * Kept inline rather than moved to `scenarios/`, deliberately. The smoke test
 * has to be able to say "the rig itself is fine" when a scenario is broken, so
 * it must not depend on scenario loading. It does go through the NVDA target,
 * so a passing smoke proves the path every real run takes.
 */
const STEPS: CompiledStep[] = [
  { label: "title bar (NVDA+T)", spec: "perform:reportTitle" },
  { label: "current focus (NVDA+Tab)", spec: "perform:reportCurrentFocus" },
  { label: "next table (T)", spec: "perform:moveToNextTable" },
  { label: "next table again (T)", spec: "perform:moveToNextTable" },
];

const SCENARIO: CompiledScenario = { reader: "nvda", name: "smoke", description: "", steps: STEPS, checks: [] };

function smokeRequest(): SmokeRequest | undefined {
  const path = process.env.RIG_SMOKE_REQUEST ?? "artifacts/smoke-request.json";
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SmokeRequest;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const request = smokeRequest();
const target = process.argv[2] ?? SMOKE_CONTROL_FIXTURE;
const out = [`# smoke on ${target}`, "", ...nvdaTarget.environment(), ""];
let ok = false;
let completedSteps = 0;
let speechCaptured = false;
let focusLost: string | null = null;
let failure: string | null = null;
let session: ReaderSession | undefined;

try {
  session = await nvdaTarget.start();
  session.validate(SCENARIO);
  const opened = await session.open(target, SCENARIO);
  out.push(opened.target.provenance, "", ...opened.lines);

  if (opened.ok) {
    const { steps, focusLost: lostFocus } = await session.perform(SCENARIO, (step) =>
      console.log(`${step.label} [${wireSpec(step.spec)}] :: ${step.heard.replace(/\n/g, " / ")}`),
    );
    for (const step of steps) {
      out.push(`### ${step.label} [${wireSpec(step.spec)}]`, step.heard, "");
    }
    completedSteps = steps.length;
    speechCaptured = steps.some((step) => step.heard !== SILENCE);
    // The smoke test asserts only that the rig works: NVDA started, the page
    // was reached, and quick navigation answered. What it answered *with* is
    // the runner's business.
    ok =
      !lostFocus &&
      steps.length === STEPS.length &&
      steps.every((step) => !step.error) &&
      speechCaptured;
    if (lostFocus) {
      focusLost = lostFocus;
      out.push("### FOCUS LOST", `  ${lostFocus} had the foreground.`, "");
    }
  }
} catch (error) {
  const caught = error as Error;
  failure = caught?.message ?? String(error);
  console.error("FAILED:", caught?.message);
  console.error("CAUSE:", (caught?.cause as Error)?.message ?? caught?.cause ?? "(none)");
  out.push("### error", caught?.message ?? "", (caught?.cause as Error)?.message ?? "");
} finally {
  const artifact = resolve(
    request?.speech ?? process.env.RIG_SMOKE_ARTIFACT ?? "artifacts/smoke-log.txt",
  );
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, out.join("\n") + "\n", "utf8");
  try {
    await session?.stop();
  } catch (error) {
    failure ??= (error as Error).message;
    ok = false;
  }
  const result: SmokeResult = {
    schemaVersion: SMOKE_RESULT_SCHEMA_VERSION,
    runId: request?.runId ?? null,
    fixture: target,
    ok,
    expectedSteps: STEPS.length,
    completedSteps,
    speechCaptured,
    focusLost,
    error: failure,
    observed: {
      node: process.version,
      executable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
      executionPosture: process.env.RIG_EXECUTION_POSTURE ?? null,
    },
  };
  const resultArtifact = resolve(request?.result ?? "artifacts/smoke-result.json");
  mkdirSync(dirname(resultArtifact), { recursive: true });
  writeFileSync(resultArtifact, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(ok ? "\nSMOKE OK" : `\nSMOKE FAILED — see ${artifact}`);
  process.exitCode = ok ? 0 : 1;
}
