/**
 * The health report is the Provisioner's evidence. The Smoke's printed result
 * is its completion and health contract: neither the reporter's exit code
 * alone nor transcript prose can prove this smoke.
 *
 *   node dist/provisioning/health-report.js [report.json] [--stages stages.json] [--host-url url]
 *
 * Run from the rig's state directory, as the Provisioner does: the report and
 * the Smoke's transcript are written relative to it.
 *
 * `--stages` is the PowerShell provisioner's record of the reviewed Runtime
 * Manifest steps. A failed stage means the rig has no runtime to prove, so the
 * real NVDA proof is skipped and the report names the stage that failed.
 * `--host-url` is diagnosis only and never reaches the verdict.
 *
 * The Smoke is a client of the logon daemon, so this needs `RIG_TOKEN` in its
 * environment, which the provisioner takes from the user's environment where
 * `tasks\register.ps1` put it.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { assessProvisioning, probeHostUrl, type ProvisioningStage } from "./health.ts";
import type { SmokeResult } from "../lib/smoke-result.ts";

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

/** The `SmokeResult` is the last line the Smoke prints. */
function readSmokeResult(stdout: string | undefined): SmokeResult | undefined {
  const last = stdout?.trim().split(/\r?\n/).at(-1);
  if (!last?.startsWith("{")) return undefined;
  try {
    return JSON.parse(last) as SmokeResult;
  } catch {
    return undefined;
  }
}

// The Smoke, one directory up, in the same form as this file: the source in
// the repository, the build in an installed package.
const smokeScript = join(import.meta.dirname, "..", `smoke${extname(import.meta.filename)}`);
const requested = process.argv[2];
const output = resolve(requested?.startsWith("-") === false ? requested : "health-report.json");
const artifacts = { transcript: resolve("artifacts", "smoke-transcript.txt") };
const runtime = readStages(option("stages"));
const failedStage = runtime.find((stage) => !stage.ok);
let run: ReturnType<typeof spawnSync> | undefined;
let smoke: SmokeResult | undefined;
let failure: string | undefined;

if (failedStage) {
  failure = `runtime stage "${failedStage.name}" failed: ${failedStage.detail}`;
} else {
  // The same Node as this reporter, which is the provisioned one, and the
  // environment the provisioner set: RIG_TOKEN, RIG_PORT, RIG_BROWSER_PORT.
  run = spawnSync(process.execPath, [smokeScript, "--transcript", artifacts.transcript], { encoding: "utf8" });
  smoke = readSmokeResult(run.stdout as string | undefined);
  if (run.error) failure = run.error.message;
  else if (!smoke) failure = `the smoke exited ${run.status ?? "without a status"} and printed no result`;
  else if (!smoke.ok) failure = smoke.error ?? "the page was reached but nothing spoke";
}

const report = assessProvisioning({
  runtime,
  smoke,
  artifacts,
  hostUrlProbe: await probeHostUrl(option("host-url")),
  observed: {
    reporterNode: process.version,
    reporterPlatform: process.platform,
    reporterArchitecture: process.arch,
    transcriptBytes: fileSize(artifacts.transcript),
    smokeOutput: [run?.stdout, run?.stderr].filter(Boolean).join("\n"),
    ...(smoke ? { smoke } : {}),
  },
  failure,
});
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
