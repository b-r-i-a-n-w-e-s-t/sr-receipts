import test from "node:test";
import assert from "node:assert/strict";
import { assessSmoke, hasCapturedSpeech } from "../provisioning/health.ts";

test("health proof requires speech from a smoke step, not a non-empty log", () => {
  const headerOnly = "# smoke on control.html\n\nwindows: 11\n";
  assert.equal(hasCapturedSpeech(headerOnly), false);
  assert.equal(hasCapturedSpeech("### title\n(silence)\n"), false);
  assert.equal(hasCapturedSpeech("### title\nMozilla Firefox\n"), true);
});

test("host connectivity is not an input to the provisioning verdict", () => {
  const report = assessSmoke(true, "### title\nMozilla Firefox\n", "smoke-log.txt");
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks, { smokeExited: true, speechCaptured: true });
});

test("a failed smoke remains unhealthy even if an artifact has speech", () => {
  const report = assessSmoke(false, "### title\nMozilla Firefox\n", "smoke-log.txt", "smoke exited 1");
  assert.equal(report.ok, false);
  assert.equal(report.failure, "smoke exited 1");
});
