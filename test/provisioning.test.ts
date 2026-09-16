import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessSmoke, hasCapturedSpeech } from "../provisioning/health.ts";

const observed = {
  node: "v22.18.0",
  platform: "win32",
  architecture: "arm64",
  taskOutput: "nvda-smoke LastTaskResult: 0",
};

test("health proof requires speech from a smoke step, not a non-empty log", () => {
  const headerOnly = "# smoke on control.html\n\nwindows: 11\n";
  assert.equal(hasCapturedSpeech(headerOnly), false);
  assert.equal(hasCapturedSpeech("### title\n(silence)\n"), false);
  assert.equal(hasCapturedSpeech("### title\nMozilla Firefox\n"), true);
});

test("host connectivity is not an input to the provisioning verdict", () => {
  const report = assessSmoke(
    true,
    "### title\nMozilla Firefox\n",
    "artifacts/smoke-log.txt",
    true,
    observed,
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks, {
    smokeExited: true,
    speechCaptured: true,
    freshArtifact: true,
  });
  assert.deepEqual(report.observed, observed);
});

test("a failed smoke remains unhealthy even if an artifact has speech", () => {
  const report = assessSmoke(
    false,
    "### title\nMozilla Firefox\n",
    "artifacts/smoke-log.txt",
    true,
    observed,
    "smoke exited 1",
  );
  assert.equal(report.ok, false);
  assert.equal(report.failure, "smoke exited 1");
});

test("a stale artifact cannot prove a provision", () => {
  const report = assessSmoke(
    true,
    "### title\nMozilla Firefox\n",
    "artifacts/smoke-log.txt",
    false,
    observed,
  );
  assert.equal(report.ok, false);
  assert.equal(report.checks.freshArtifact, false);
});

test("runtime manifest agrees with the locked packages and Guidepup NVDA manifest", () => {
  const runtime = JSON.parse(
    readFileSync("provisioning/runtime-manifest.json", "utf8"),
  ) as {
    node: { version: string; architecture: string; kind: string; sha256: string };
    firefox: { version: string; architecture: string; sha256: string };
    guidepup: {
      version: string;
      setupVersion: string;
      nvdaAsset: {
        id: string;
        version: string;
        repository: string;
        asset: string;
        sha256: string;
      };
    };
  };
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };
  const guidepupManifest = JSON.parse(
    readFileSync("node_modules/@guidepup/guidepup/manifest.json", "utf8"),
  ) as {
    screenReaders: Array<{
      id: string;
      assets: Array<{
        version: string;
        repository: string;
        asset: string;
        sha256: string;
      }>;
    }>;
  };
  const nvda = guidepupManifest.screenReaders.find(
    (screenReader) => screenReader.id === runtime.guidepup.nvdaAsset.id,
  )?.assets[0];

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
    version: runtime.guidepup.nvdaAsset.version,
    repository: runtime.guidepup.nvdaAsset.repository,
    asset: runtime.guidepup.nvdaAsset.asset,
    sha256: runtime.guidepup.nvdaAsset.sha256,
  });
});
