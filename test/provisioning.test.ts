import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessSmoke } from "../provisioning/health.ts";
import {
  SMOKE_CONTROL_FIXTURE,
  SMOKE_RESULT_SCHEMA_VERSION,
  SCHEDULED_TASK_POSTURE,
  type SmokeResult,
} from "../lib/smoke-result.ts";

const smoke: SmokeResult = {
  schemaVersion: SMOKE_RESULT_SCHEMA_VERSION, runId: "1", fixture: SMOKE_CONTROL_FIXTURE, ok: true,
  expectedSteps: 4, completedSteps: 4, speechCaptured: true, focusLost: null, error: null,
  observed: {
    node: "v22.18.0",
    executable: String.raw`C:\Users\Rig\AppData\Local\nvda-rig\node-v22.18.0-win-arm64\node.exe`,
    platform: "win32", architecture: "arm64", executionPosture: SCHEDULED_TASK_POSTURE,
  },
};
const observed = {
  reporterNode: "v22.18.0", reporterPlatform: "win32", reporterArchitecture: "arm64",
  taskOutput: "nvda-smoke result: artifacts/smoke-result-1.json", smoke: smoke.observed,
};

test("health proof uses the smoke JSON contract, not transcript text", () => {
  const report = assessSmoke(true, smoke, "artifacts/smoke-result-1.json", true, observed);
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks, {
    taskCompleted: true, smokePassed: true, speechCaptured: true, focusRetained: true,
    scheduledCmdNode: true, freshArtifact: true,
  });
});

test("focus loss and silent speech cannot become a healthy report", () => {
  const report = assessSmoke(
    true, { ...smoke, speechCaptured: false, focusLost: "Windows Security" },
    "artifacts/smoke-result-1.json", true, observed,
  );
  assert.equal(report.ok, false);
  assert.equal(report.checks.speechCaptured, false);
  assert.equal(report.checks.focusRetained, false);
});

test("only the scheduled-task CMD posture using per-user Node proves the entry point", () => {
  const report = assessSmoke(
    true,
    { ...smoke, observed: { ...smoke.observed, executionPosture: null, executable: "C:\\node\\node.exe" } },
    "artifacts/smoke-result-1.json", true, observed,
  );
  assert.equal(report.ok, false);
  assert.equal(report.checks.scheduledCmdNode, false);
});

test("CMD entry points explicitly use the provisioned per-user Node wrapper", () => {
  for (const entry of ["run-control.cmd", "run-daemon.cmd", "run-probe.cmd", "run-queue.cmd"]) {
    assert.match(readFileSync(entry, "utf8"), /call "%~dp0run-node\.cmd"/i, entry);
  }
  assert.match(
    readFileSync("run-node.cmd", "utf8"),
    /%LOCALAPPDATA%\\nvda-rig\\node-v22\.18\.0-win-arm64\\node\.exe/i,
  );
});

test("the task protocol is result-controlled and cleans up on timeout", () => {
  const task = readFileSync("provisioning/run-smoke-task.ps1", "utf8");
  assert.doesNotMatch(task, /LastRunTime/);
  assert.match(task, /smoke-result-\$RunId\.json/);
  assert.match(task, /Stop-ScheduledTask/);
  assert.match(task, /Remove-Item -Force -ErrorAction SilentlyContinue \$request, \$result, \$smokeArtifact/);
});

test("runtime manifest agrees with the locked packages and Guidepup NVDA manifest", () => {
  const runtime = JSON.parse(readFileSync("provisioning/runtime-manifest.json", "utf8")) as {
    node: { version: string; architecture: string; kind: string; sha256: string };
    firefox: { version: string; architecture: string; sha256: string };
    guidepup: { version: string; setupVersion: string; nvdaAsset: { id: string; version: string; repository: string; asset: string; sha256: string } };
  };
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  const guidepupManifest = JSON.parse(readFileSync("node_modules/@guidepup/guidepup/manifest.json", "utf8")) as {
    screenReaders: Array<{ id: string; assets: Array<{ version: string; repository: string; asset: string; sha256: string }> }>;
  };
  const nvda = guidepupManifest.screenReaders.find((screenReader) => screenReader.id === runtime.guidepup.nvdaAsset.id)?.assets[0];
  assert.equal(runtime.node.version, "22.18.0");
  assert.equal(runtime.node.architecture, "arm64");
  assert.equal(runtime.node.kind, "zip");
  assert.match(runtime.node.sha256, /^[a-f0-9]{64}$/);
  assert.equal(runtime.firefox.version, "156.0");
  assert.equal(runtime.firefox.architecture, "arm64");
  assert.match(runtime.firefox.sha256, /^[a-f0-9]{64}$/);
  assert.equal(pkg.dependencies["@guidepup/guidepup"], runtime.guidepup.version);
  assert.equal(pkg.dependencies["@guidepup/setup"], runtime.guidepup.setupVersion);
  assert.deepEqual(nvda, {
    version: runtime.guidepup.nvdaAsset.version, repository: runtime.guidepup.nvdaAsset.repository,
    asset: runtime.guidepup.nvdaAsset.asset, sha256: runtime.guidepup.nvdaAsset.sha256,
  });
});
