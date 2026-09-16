import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_HOST_URL_PROBE,
  assessProvisioning,
  type ProvisioningStage,
} from "../provisioning/health.ts";
import {
  SMOKE_CONTROL_FIXTURE,
  SMOKE_RESULT_SCHEMA_VERSION,
  SCHEDULED_TASK_POSTURE,
  smokeArtifacts,
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
const artifacts = smokeArtifacts("1");
const observed = {
  reporterNode: "v22.18.0", reporterPlatform: "win32", reporterArchitecture: "arm64",
  speechArtifactBytes: 2048,
  taskOutput: `nvda-smoke result: ${artifacts.result}`, smoke: smoke.observed,
};
const runtime: ProvisioningStage[] = [
  { name: "architecture", ok: true, detail: "ARM64" },
  { name: "node", ok: true, detail: "v22.18.0" },
  { name: "firefox", ok: true, detail: "156.0" },
  { name: "packages", ok: true, detail: "npm ci" },
  { name: "guidepup-nvda", ok: true, detail: "0.2.1-2026.2" },
  { name: "tasks", ok: true, detail: "nvda-smoke registered" },
];
const healthy = {
  runtime, taskCompleted: true, smoke, artifacts, freshArtifact: true,
  hostUrlProbe: NO_HOST_URL_PROBE, observed,
};

test("health proof uses the smoke JSON contract, not transcript text", () => {
  const report = assessProvisioning(healthy);
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks, {
    runtimeInstalled: true, taskCompleted: true, smokePassed: true, speechCaptured: true,
    speechArtifact: true, focusRetained: true, scheduledCmdNode: true, freshArtifact: true,
  });
  assert.deepEqual(report.artifacts, {
    result: "artifacts/smoke-result-1.json", speech: "artifacts/smoke-log-1.txt",
  });
});

test("focus loss and silent speech cannot become a healthy report", () => {
  const report = assessProvisioning({
    ...healthy,
    smoke: { ...smoke, speechCaptured: false, focusLost: "Windows Security" },
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.speechCaptured, false);
  assert.equal(report.checks.focusRetained, false);
});

test("an empty or missing speech artifact cannot become a healthy report", () => {
  const report = assessProvisioning({
    ...healthy, observed: { ...observed, speechArtifactBytes: 0 },
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.speechArtifact, false);
});

test("a failed runtime stage is named in the report instead of vanishing", () => {
  const failed: ProvisioningStage[] = [
    { name: "architecture", ok: true, detail: "ARM64" },
    { name: "node", ok: true, detail: "v22.18.0" },
    { name: "firefox", ok: false, detail: "expected 156.0, found 155.0.1" },
  ];
  const report = assessProvisioning({
    ...healthy, runtime: failed, taskCompleted: false, smoke: undefined,
    freshArtifact: false, observed: { ...observed, speechArtifactBytes: 0 },
    failure: 'runtime stage "firefox" failed',
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.runtimeInstalled, false);
  assert.equal(report.failure, 'runtime stage "firefox" failed');
  assert.deepEqual(report.runtime, failed);
});

test("a report with no runtime evidence at all is not healthy", () => {
  assert.equal(assessProvisioning({ ...healthy, runtime: [] }).checks.runtimeInstalled, false);
});

test("the host URL probe is reported but never changes the verdict", () => {
  const failedProbe = {
    attempted: true, ok: false, url: "http://192.168.64.1:5173/",
    failure: "No connection could be made because the target machine actively refused it",
  };
  const report = assessProvisioning({ ...healthy, hostUrlProbe: failedProbe });
  assert.equal(report.ok, true);
  assert.deepEqual(report.hostUrlProbe, failedProbe);
  assert.deepEqual(assessProvisioning(healthy).hostUrlProbe, {
    attempted: false, ok: null, url: null, failure: null,
  });
});

test("only the scheduled-task CMD posture using per-user Node proves the entry point", () => {
  const report = assessProvisioning({
    ...healthy,
    smoke: { ...smoke, observed: { ...smoke.observed, executionPosture: null, executable: "C:\\node\\node.exe" } },
  });
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

test("no script parameter default depends on $PSScriptRoot", () => {
  // Windows PowerShell binds a script's parameter defaults before the script's
  // own $PSScriptRoot exists, so such a default is an empty path and the
  // script dies on its first Join-Path. Resolve these in the body instead.
  for (const script of [
    "provisioning/provision.ps1",
    "provisioning/run-smoke-task.ps1",
    "tasks/register.ps1",
  ]) {
    const block = /^param\(([\s\S]*?)^\)/m.exec(readFileSync(script, "utf8"));
    assert.ok(block?.[1], `${script} has no script parameter block`);
    assert.doesNotMatch(block[1], /\$PSScriptRoot/, script);
  }
});

test("the task protocol is result-controlled and cleans up on timeout", () => {
  const task = readFileSync("provisioning/run-smoke-task.ps1", "utf8");
  assert.doesNotMatch(task, /LastRunTime/);
  // The reporter owns both artifact paths, so the two scripts cannot disagree
  // about which files this run's proof lives in.
  assert.doesNotMatch(task, /smoke-result-|smoke-log-/);
  assert.match(task, /\[Parameter\(Mandatory\)\]\[string\]\$Result/);
  assert.match(task, /\[Parameter\(Mandatory\)\]\[string\]\$Speech/);
  assert.match(task, /Stop-ScheduledTask/);
  assert.match(task, /Remove-Item -Force -ErrorAction SilentlyContinue \$request, \$Result, \$Speech/);
  // The request it writes is the SmokeRequest contract smoke.ts reads.
  for (const key of ["runId", "result", "speech"]) {
    assert.match(task, new RegExp(`${key} = `), key);
  }
});

test("the provisioner's no-Node fallback report cannot drift from the report type", () => {
  const script = readFileSync("provisioning/provision.ps1", "utf8");
  // Shaped like the report PowerShell writes: no smoke ran, and a failure.
  const report = assessProvisioning({
    ...healthy, smoke: undefined, taskCompleted: false, freshArtifact: false,
    observed: {
      reporterNode: "", reporterPlatform: "win32", reporterArchitecture: "ARM64",
      speechArtifactBytes: 0, taskOutput: "",
    },
    failure: "no provisioned runtime",
  });
  const literal = script.slice(script.indexOf("$fallback = [ordered]@{"));
  assert.ok(literal, "provision.ps1 writes no fallback report");
  /** The keys of one brace-free nested literal, or of the fallback itself. */
  const keys = (name?: string): string[] => {
    const source = name
      ? new RegExp(String.raw`${name} = \[ordered\]@\{([^}]*)\}`).exec(literal)?.[1]
      // Top-level keys are the fallback's own indentation level; nested
      // literals sit deeper, so they cannot be mistaken for one.
      : literal.slice(0, literal.indexOf("\n  }"));
    assert.ok(source, `provision.ps1 has no ${name ?? "fallback"} literal`);
    const pattern = name ? /(\w+)\s*=/g : /^ {4}(\w+) =/gm;
    return [...source.matchAll(pattern)].map((key) => key[1] ?? "").sort();
  };
  assert.deepEqual(keys(), Object.keys(report).sort());
  assert.deepEqual(keys("checks"), Object.keys(report.checks).sort());
  assert.deepEqual(keys("artifacts"), Object.keys(report.artifacts).sort());
  assert.deepEqual(keys("hostUrlProbe"), Object.keys(report.hostUrlProbe).sort());
  assert.deepEqual(keys("observed"), Object.keys(report.observed).sort());
  assert.match(script, new RegExp(`schemaVersion = ${report.schemaVersion}\\b`));
  // Two facts the fallback must observe rather than assert: a reporter crash
  // leaves the runtime installed, and Node's version is knowable from it.
  assert.match(script, /runtimeInstalled = \$runtimeInstalled/);
  assert.match(script, /reporterNode = \$reporterNode/);
});

test("runtime stages are recorded rather than thrown away, and the probe never gates", () => {
  const script = readFileSync("provisioning/provision.ps1", "utf8");
  // Every manifest component is a named stage, so a dependency failure is
  // distinguishable from a desktop or speech-capture failure in the report.
  for (const stage of ["architecture", "node", "firefox", "packages", "guidepup-nvda", "tasks"]) {
    assert.match(script, new RegExp(`'${stage}'`), stage);
  }
  assert.match(script, /'--stages', \$StagePath/);
  // The probe belongs to the reporter now: nothing rewrites the finished report.
  assert.doesNotMatch(script, /Invoke-WebRequest -Uri \$HostUrl/);
  assert.doesNotMatch(script, /Add-Member/);
  assert.match(script, /'--host-url', \$HostUrl/);
  // A stale ok:true report from an earlier run must not stand in for one this
  // run failed to write.
  assert.match(script, /Remove-Item -Force -ErrorAction SilentlyContinue \$ReportPath/);
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
