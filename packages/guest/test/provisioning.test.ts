import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  HEALTH_REPORT_SCHEMA_VERSION,
  NO_HOST_URL_PROBE,
  assessProvisioning,
  probeHostUrl,
  type ProvisioningStage,
} from "../provisioning/health.ts";
import { SMOKE_COMMANDS, type SmokeResult } from "../lib/smoke-result.ts";

/** A file of this package, read from wherever the tests were started. */
const source = (path: string): string => readFileSync(join(import.meta.dirname, "..", path), "utf8");

const smoke: SmokeResult = {
  ok: true, daemon: true, entered: true, commands: SMOKE_COMMANDS.length, spoke: 3, error: null,
  environment: ["windows: 11 26100", "nvda: 2025.1", "edge: 153.0.4234.48"],
};
const artifacts = { transcript: String.raw`C:\rig\artifacts\smoke-transcript.txt` };
const observed = {
  reporterNode: "v22.18.0", reporterPlatform: "win32", reporterArchitecture: "arm64",
  transcriptBytes: 2048,
  smokeOutput: "SMOKE OK", smoke,
};
const runtime: ProvisioningStage[] = [
  { name: "architecture", ok: true, detail: "ARM64" },
  { name: "node", ok: true, detail: "v22.18.0" },
  { name: "edge", ok: true, detail: "153.0.4234.48" },
  { name: "packages", ok: true, detail: "npm ci" },
  { name: "guidepup-nvda", ok: true, detail: "0.2.1-2026.2" },
  { name: "tasks", ok: true, detail: "nvda-daemon registered" },
  { name: "daemon", ok: true, detail: "nvda-daemon Running" },
];
const healthy = { runtime, smoke, artifacts, hostUrlProbe: NO_HOST_URL_PROBE, observed };

test("health proof uses the smoke's printed result, not transcript text", () => {
  const report = assessProvisioning(healthy);
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks, {
    runtimeInstalled: true, daemonAnswered: true, smokePassed: true, speechCaptured: true, transcriptArtifact: true,
  });
  assert.deepEqual(report.artifacts, artifacts);
});

test("a daemon that never answered is the failure, and nothing after it can pass", () => {
  const report = assessProvisioning({
    ...healthy,
    smoke: { ...smoke, ok: false, daemon: false, entered: false, spoke: 0, error: "the daemon did not answer within 60 s <- fetch failed", environment: [] },
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks, {
    runtimeInstalled: true, daemonAnswered: false, smokePassed: false, speechCaptured: false, transcriptArtifact: true,
  });
});

test("silent speech cannot become a healthy report, even if the smoke claimed to pass", () => {
  const report = assessProvisioning({ ...healthy, smoke: { ...smoke, spoke: 0 } });
  assert.equal(report.ok, false);
  assert.equal(report.checks.speechCaptured, false);
});

test("an empty or missing transcript cannot become a healthy report", () => {
  const report = assessProvisioning({ ...healthy, observed: { ...observed, transcriptBytes: 0 } });
  assert.equal(report.ok, false);
  assert.equal(report.checks.transcriptArtifact, false);
});

test("a failed runtime stage is named in the report instead of vanishing", () => {
  const failed: ProvisioningStage[] = [
    { name: "architecture", ok: true, detail: "ARM64" },
    { name: "node", ok: true, detail: "v22.18.0" },
    { name: "edge", ok: false, detail: "no msedge.exe under Program Files" },
  ];
  const report = assessProvisioning({
    ...healthy, runtime: failed, smoke: undefined,
    observed: { reporterNode: "v22.18.0", reporterPlatform: "win32", reporterArchitecture: "arm64", transcriptBytes: 0, smokeOutput: "" },
    failure: 'runtime stage "edge" failed',
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.runtimeInstalled, false);
  assert.equal(report.checks.daemonAnswered, false);
  assert.equal(report.failure, 'runtime stage "edge" failed');
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

test("the probe answers what a maintainer can act on", async (t) => {
  let status = 200;
  const server = createServer((_request, response) => {
    response.writeHead(status).end();
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  assert.deepEqual(await probeHostUrl(url), {
    attempted: true, ok: true, url, failure: null,
  });

  // A served error is reachability with a broken app: say which it was.
  status = 503;
  assert.deepEqual(await probeHostUrl(url), {
    attempted: true, ok: false, url, failure: "503 Service Unavailable",
  });

  assert.deepEqual(await probeHostUrl(undefined), NO_HOST_URL_PROBE);
});

test("an unreachable host URL reports the cause, not just 'fetch failed'", async () => {
  // Nothing listens on a closed port, which is what a Mac with no dev server
  // running looks like from the guest.
  const closed = createServer();
  await new Promise<void>((ready) => closed.listen(0, "127.0.0.1", ready));
  const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/`;
  await new Promise<void>((closedDown) => closed.close(() => closedDown()));

  const probe = await probeHostUrl(url);
  assert.equal(probe.ok, false);
  assert.equal(probe.url, url);
  assert.match(probe.failure ?? "", /ECONNREFUSED/);
});

test("the daemon's CMD entry point explicitly uses the provisioned per-user Node wrapper", () => {
  assert.match(source("run-daemon.cmd"), /call "%~dp0run-node\.cmd"/i);
  assert.match(
    source("run-node.cmd"),
    /%LOCALAPPDATA%\\nvda-rig\\node-v22\.18\.0-win-arm64\\node\.exe/i,
  );
});

test("no script parameter default depends on $PSScriptRoot", () => {
  // Windows PowerShell binds a script's parameter defaults before the script's
  // own $PSScriptRoot exists, so such a default is an empty path and the
  // script dies on its first Join-Path. Resolve these in the body instead.
  for (const script of ["provisioning/provision.ps1", "tasks/register.ps1"]) {
    const block = /^param\(([\s\S]*?)^\)/m.exec(source(script));
    assert.ok(block?.[1], `${script} has no script parameter block`);
    assert.doesNotMatch(block[1], /\$PSScriptRoot/, script);
  }
});

test("the Smoke is a client of the logon daemon: one task, no smoke task, and the token reaches the reporter", () => {
  const register = source("tasks/register.ps1");
  assert.match(register, /Register-RigTask -Name 'nvda-daemon' -Script 'run-daemon\.cmd' -AtLogon/);
  assert.doesNotMatch(register, /Register-RigTask -Name 'nvda-smoke'/);
  // A rig provisioned before the change carries the old task; it is retired.
  assert.match(register, /foreach \(\$retired in [^)]*'nvda-smoke'/);

  const provision = source("provisioning/provision.ps1");
  const daemon = provision.slice(provision.indexOf("Invoke-Stage 'daemon'"), provision.indexOf("New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StagePath)"));
  assert.ok(daemon, "provision.ps1 has no daemon stage");
  // Restarted, so the daemon proved is the one just provisioned.
  assert.match(daemon, /Stop-ScheduledTask -InputObject \$task/);
  assert.match(daemon, /Start-ScheduledTask -InputObject \$task/);
  // The reporter's Smoke reaches the daemon with what the logon task inherits.
  assert.match(daemon, /\$env:RIG_TOKEN = \[Environment\]::GetEnvironmentVariable\('RIG_TOKEN', 'User'\)/);
  assert.doesNotMatch(provision, /nvda-smoke/);
});

test("the provisioner's no-Node fallback report cannot drift from the report type", () => {
  const script = source("provisioning/provision.ps1");
  // Shaped like the report PowerShell writes: no smoke ran, and a failure.
  const report = assessProvisioning({
    ...healthy, smoke: undefined,
    observed: {
      reporterNode: "", reporterPlatform: "win32", reporterArchitecture: "ARM64",
      transcriptBytes: 0, smokeOutput: "",
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
  assert.ok(script.includes(`execution = "${report.execution}"`), "the fallback's execution text is the reporter's");
  // Two facts the fallback must observe rather than assert: a reporter crash
  // leaves the runtime installed, and Node's version is knowable from it.
  assert.match(script, /runtimeInstalled = \$runtimeInstalled/);
  assert.match(script, /reporterNode = \$reporterNode/);
});

/**
 * The guest is a workspace package. `npm ci` only honours the committed
 * lockfile from the workspace root, and it installs Guidepup there rather than
 * beside this package, so the stages that install and read it must both look
 * there. Getting this wrong fails on the guest, where nothing here runs.
 */
test("the provisioner installs and reads packages at the workspace root", () => {
  const script = source("provisioning/provision.ps1");
  assert.match(script, /\$workspace = Split-Path -Parent \(Split-Path -Parent \$rig\)/);
  const packages = script.slice(script.indexOf("Invoke-Stage 'packages'"), script.indexOf("Invoke-Stage 'tasks'"));
  assert.match(packages, /Push-Location \$workspace/);
  assert.match(packages, /Join-Path \$workspace 'node_modules\\@guidepup\\guidepup\\package\.json'/);
  assert.match(packages, /Join-Path \$workspace 'node_modules\\@guidepup\\setup\\bin\\guidepup'/);
});

test("runtime stages are recorded rather than thrown away, and the probe never gates", () => {
  const script = source("provisioning/provision.ps1");
  // Every manifest component is a named stage, so a dependency failure is
  // distinguishable from a desktop or speech-capture failure in the report.
  for (const stage of ["architecture", "node", "edge", "packages", "guidepup-nvda", "tasks", "daemon"]) {
    assert.match(script, new RegExp(`Invoke-Stage '${stage}'`), stage);
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
  const runtime = JSON.parse(source("provisioning/runtime-manifest.json")) as {
    node: { version: string; architecture: string; kind: string; sha256: string };
    edge: { source: string };
    playwright: { version: string };
    guidepup: { version: string; setupVersion: string; nvdaAsset: { id: string; version: string; repository: string; asset: string; sha256: string } };
  };
  const pkg = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
  // Resolved, not joined: npm workspaces install it at the workspace root.
  const guidepupManifestPath = createRequire(import.meta.url).resolve("@guidepup/guidepup/manifest.json");
  const guidepupManifest = JSON.parse(readFileSync(guidepupManifestPath, "utf8")) as {
    screenReaders: Array<{ id: string; assets: Array<{ version: string; repository: string; asset: string; sha256: string }> }>;
  };
  const nvda = guidepupManifest.screenReaders.find((screenReader) => screenReader.id === runtime.guidepup.nvdaAsset.id)?.assets[0];
  assert.equal(runtime.node.version, "22.18.0");
  assert.equal(runtime.node.architecture, "arm64");
  assert.equal(runtime.node.kind, "zip");
  assert.match(runtime.node.sha256, /^[a-f0-9]{64}$/);
  // Edge is the one browser Windows on ARM64 ships and Playwright can drive
  // natively; it is verified present, never downloaded.
  assert.equal(runtime.edge.source, "preinstalled with Windows 11");
  // A Playwright client can only connect to a browser server of the same
  // major.minor, so the guest's version is what every consumer must match.
  assert.equal(pkg.dependencies["playwright-core"], runtime.playwright.version);
  assert.equal(pkg.dependencies["@guidepup/guidepup"], runtime.guidepup.version);
  assert.equal(pkg.dependencies["@guidepup/setup"], runtime.guidepup.setupVersion);
  assert.deepEqual(nvda, {
    version: runtime.guidepup.nvdaAsset.version, repository: runtime.guidepup.nvdaAsset.repository,
    asset: runtime.guidepup.nvdaAsset.asset, sha256: runtime.guidepup.nvdaAsset.sha256,
  });
});

test("the reporter, run as the Provisioner runs it, names a failed stage and never starts the smoke", async () => {
  // Only the failed-stage path: any other would run the real smoke against a
  // daemon, which needs a Windows guest.
  const dir = mkdtempSync(join(tmpdir(), "health-report-"));
  const stages = join(dir, "stages.json");
  const output = join(dir, "report.json");
  writeFileSync(stages, JSON.stringify([
    { name: "node", ok: true, detail: "v22.18.0" },
    { name: "edge", ok: false, detail: "no msedge.exe under Program Files" },
  ]));
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "..", "provisioning", "health-report.ts"), output, "--stages", stages], {
    encoding: "utf8",
  });
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(readFileSync(output, "utf8")) as ReturnType<typeof assessProvisioning>;
  assert.equal(report.schemaVersion, HEALTH_REPORT_SCHEMA_VERSION);
  assert.equal(report.ok, false);
  assert.equal(report.failure, 'runtime stage "edge" failed: no msedge.exe under Program Files');
  assert.equal(report.checks.runtimeInstalled, false);
  assert.equal(report.checks.daemonAnswered, false);
  assert.equal(report.observed.smokeOutput, "");
  assert.deepEqual(report.hostUrlProbe, NO_HOST_URL_PROBE);
});

test("the smoke itself, with no token, refuses before touching anything", () => {
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "..", "smoke.ts")], {
    encoding: "utf8",
    env: { ...process.env, RIG_TOKEN: "" },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /RIG_TOKEN is not set/);
});
