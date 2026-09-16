/**
 * Execute the self-contained NVDA/Firefox fixture smoke and write its verdict.
 * This is intentionally a guest-local command: headed Firefox and NVDA need
 * the signed-in Windows desktop and cannot be proven through SSH.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assessSmoke } from "./health.ts";

const rig = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] ?? "provisioning/health-report.json");
const smokeArtifact = resolve(rig, "artifacts/smoke-log.txt");
const taskOutput = resolve(rig, "artifacts/smoke-task.out");
const startedAt = new Date();
const run = spawnSync("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "provisioning/run-smoke-task.ps1",
], {
  cwd: rig,
  encoding: "utf8",
});
const smokeLog = existsSync(smokeArtifact) ? readFileSync(smokeArtifact, "utf8") : undefined;
const freshArtifact =
  smokeLog !== undefined && statSync(smokeArtifact).mtime >= startedAt;
const diagnostics = [
  run.stdout,
  run.stderr,
  existsSync(taskOutput) ? readFileSync(taskOutput, "utf8") : "",
].filter(Boolean).join("\n");
const report = assessSmoke(
  run.status === 0,
  smokeLog,
  smokeArtifact,
  freshArtifact,
  {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    taskOutput: diagnostics,
  },
  run.error?.message ?? (run.status === 0 ? undefined : `smoke task exited ${run.status ?? "without a status"}`),
);

writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
