/**
 * Execute the self-contained NVDA/Firefox fixture smoke and write its verdict.
 * This is intentionally a guest-local command: headed Firefox and NVDA need
 * the signed-in Windows desktop and cannot be proven through SSH.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assessSmoke } from "./health.ts";

const output = resolve(process.argv[2] ?? "provisioning/health-report.json");
const smokeArtifact = resolve("smoke-log.txt");
const run = spawnSync(process.execPath, ["smoke.ts", "control.html"], {
  cwd: resolve(import.meta.dirname, ".."),
  encoding: "utf8",
});
const smokeLog = existsSync(smokeArtifact) ? readFileSync(smokeArtifact, "utf8") : undefined;
const report = assessSmoke(
  run.status === 0,
  smokeLog,
  smokeArtifact,
  run.error?.message ?? (run.status === 0 ? undefined : `smoke exited ${run.status ?? "without a status"}`),
);

writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 1;
