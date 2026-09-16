/**
 * The run-specific JSON result is the completion and health contract: neither
 * scheduler wall-clock data nor transcript prose can prove this smoke.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assessSmoke } from "./health.ts";
import type { SmokeResult } from "../lib/smoke-result.ts";

const rig = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? "provisioning/health-report.json");
const runId = `${Date.now()}-${process.pid}`;
const resultArtifact = resolve(rig, `artifacts/smoke-result-${runId}.json`);
let run: ReturnType<typeof spawnSync> | undefined;
let smoke: SmokeResult | undefined;
let failure: string | undefined;
try {
  run = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "provisioning/run-smoke-task.ps1", "-RunId", runId,
  ], { cwd: rig, encoding: "utf8" });
  if (existsSync(resultArtifact)) smoke = JSON.parse(readFileSync(resultArtifact, "utf8")) as SmokeResult;
  if (run.error) failure = run.error.message;
  else if (run.status !== 0) failure = `smoke task exited ${run.status ?? "without a status"}`;
} catch (error) {
  failure = (error as Error).message;
}
const freshArtifact = smoke?.runId === runId;
const diagnostics = [
  run?.stdout,
  run?.stderr,
  existsSync(resolve(rig, "artifacts/smoke-task.out")) ? readFileSync(resolve(rig, "artifacts/smoke-task.out"), "utf8") : "",
].filter(Boolean).join("\n");
const report = assessSmoke(run?.status === 0, smoke, resultArtifact, freshArtifact, {
  reporterNode: process.version,
  reporterPlatform: process.platform,
  reporterArchitecture: process.arch,
  taskOutput: diagnostics,
  ...(smoke ? { smoke: smoke.observed } : {}),
}, failure);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
