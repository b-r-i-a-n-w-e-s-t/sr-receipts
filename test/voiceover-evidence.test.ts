import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkExact, checkVersion, errorChain, resultFor, SUPPORTED, writeRunArtifacts } from "../voiceover/evidence.ts";
import { expectedVoiceOverAsset, preferenceAccessCheck } from "../voiceover/doctor.ts";

test("the VoiceOver target accepts only its pinned release family", () => {
  assert.equal(checkVersion("macOS", "26.6.4", SUPPORTED.macOS).ok, true);
  assert.equal(checkVersion("macOS", "26.6", SUPPORTED.macOS).ok, true);
  assert.equal(checkVersion("Safari", "26.7.0", SUPPORTED.safari).ok, false);
  assert.equal(checkExact("Guidepup", "0.34.0", SUPPORTED.guidepup).ok, true);
  assert.equal(checkExact("Guidepup", "0.34.1", SUPPORTED.guidepup).ok, false);
});

test("doctor exposes its asset and protected-preference diagnostics", () => {
  assert.equal(
    expectedVoiceOverAsset("/cache").endsWith("/voiceover/25/0.0.1-VoiceOver4/guidepup-voiceover-preferences-macos-26.dmg"),
    true,
  );
  const check = preferenceAccessCheck("/a/path-that-does-not-exist");
  assert.equal(check.ok, false);
  assert.equal(check.name, "VoiceOver preferences access");
});

test("speech proof requires a non-empty capture containing the unique heading", () => {
  assert.equal(resultFor([]).limitation?.includes("could not prove"), true);
  assert.equal(resultFor(["loading", SUPPORTED.heading]).ok, true);
  assert.equal(resultFor([SUPPORTED.heading], new Error("cleanup failed")).ok, false);
});

test("failure evidence names the failed stage and preserves nested diagnostics", () => {
  const failure = new Error("could not stop VoiceOver", { cause: new Error("Apple event timed out") });
  const result = resultFor(["partial capture"], failure, "stop VoiceOver");
  assert.deepEqual(errorChain(failure), ["could not stop VoiceOver", "Apple event timed out"]);
  assert.equal(result.stage, "stop VoiceOver");
  assert.deepEqual(result.causes, ["could not stop VoiceOver", "Apple event timed out"]);
  assert.deepEqual(result.speech, ["partial capture"]);
});

test("a failed stage persists complete observable artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "voiceover-evidence-"));
  writeRunArtifacts(directory, { fixture: "file:///fixture.html" }, ["partial capture"], new Error("timed out"), "enter Safari web content");
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "speech.json"), "utf8")), ["partial capture"]);
  const result = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
  assert.equal(result.stage, "enter Safari web content");
  assert.equal(result.error, "timed out");
  assert.match(result.limitation, /enter Safari web content/);
});
