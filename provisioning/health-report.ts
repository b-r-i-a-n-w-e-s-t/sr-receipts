/**
 * The health report is the Provisioner's evidence. The run-specific JSON result
 * is its completion and health contract: neither scheduler wall-clock data nor
 * transcript prose can prove this smoke.
 *
 *   node provisioning/health-report.ts [report.json] [--stages stages.json] [--host-url url]
 *
 * `--stages` is the PowerShell provisioner's record of the reviewed Runtime
 * Manifest steps. A failed stage means the rig has no runtime to prove, so the
 * real NVDA proof is skipped and the report names the stage that failed.
 * `--host-url` is diagnosis only and never reaches the verdict.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  NO_HOST_URL_PROBE,
  assessProvisioning,
  type HostUrlProbe,
  type ProvisioningStage,
} from "./health.ts";
import { smokeArtifacts, type SmokeResult } from "../lib/smoke-result.ts";

const PROBE_TIMEOUT_MS = 10_000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** A missing artifact and an empty one are the same failure here. */
function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function probeHostUrl(url: string | undefined): Promise<HostUrlProbe> {
  if (!url) return NO_HOST_URL_PROBE;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return {
      attempted: true,
      ok: response.ok,
      url,
      failure: response.ok ? null : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return { attempted: true, ok: false, url, failure: (error as Error).message };
  }
}

function readStages(path: string | undefined): ProvisioningStage[] {
  if (!path) return [];
  try {
    const stages = JSON.parse(readFileSync(path, "utf8")) as ProvisioningStage[];
    if (!Array.isArray(stages)) throw new Error(`${path} is not a list of stages`);
    return stages;
  } catch (error) {
    return [{ name: "stages", ok: false, detail: (error as Error).message }];
  }
}

const rig = resolve(import.meta.dirname, "..");
const requested = process.argv[2];
const output = resolve(
  requested?.startsWith("-") === false ? requested : "provisioning/health-report.json",
);
const runId = `${Date.now()}-${process.pid}`;
const relative = smokeArtifacts(runId);
const artifacts = { result: resolve(rig, relative.result), speech: resolve(rig, relative.speech) };
const runtime = readStages(option("stages"));
const failedStage = runtime.find((stage) => !stage.ok);
let run: ReturnType<typeof spawnSync> | undefined;
let smoke: SmokeResult | undefined;
let failure: string | undefined;

if (failedStage) {
  failure = `runtime stage "${failedStage.name}" failed: ${failedStage.detail}`;
} else {
  try {
    run = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "provisioning/run-smoke-task.ps1",
      "-RunId", runId, "-Result", artifacts.result, "-Speech", artifacts.speech,
    ], { cwd: rig, encoding: "utf8" });
    if (existsSync(artifacts.result)) {
      smoke = JSON.parse(readFileSync(artifacts.result, "utf8")) as SmokeResult;
    }
    if (run.error) failure = run.error.message;
    else if (run.status !== 0) failure = `smoke task exited ${run.status ?? "without a status"}`;
  } catch (error) {
    failure = (error as Error).message;
  }
}

const taskOut = resolve(rig, "artifacts/smoke-task.out");
const report = assessProvisioning({
  runtime,
  taskCompleted: run?.status === 0,
  smoke,
  artifacts,
  freshArtifact: smoke?.runId === runId,
  hostUrlProbe: await probeHostUrl(option("host-url")),
  observed: {
    reporterNode: process.version,
    reporterPlatform: process.platform,
    reporterArchitecture: process.arch,
    speechArtifactBytes: fileSize(artifacts.speech),
    taskOutput: [
      run?.stdout,
      run?.stderr,
      existsSync(taskOut) ? readFileSync(taskOut, "utf8") : "",
    ].filter(Boolean).join("\n"),
    ...(smoke ? { smoke: smoke.observed } : {}),
  },
  failure,
});
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
