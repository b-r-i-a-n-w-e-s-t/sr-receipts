import assert from "node:assert/strict";
import test from "node:test";
import { checkExact, checkVersion, resultFor, SUPPORTED } from "../voiceover/evidence.ts";

test("the VoiceOver target accepts only its pinned release family", () => {
  assert.equal(checkVersion("macOS", "26.6.4", SUPPORTED.macOS).ok, true);
  assert.equal(checkVersion("Safari", "26.7.0", SUPPORTED.safari).ok, false);
  assert.equal(checkExact("Guidepup", "0.34.0", SUPPORTED.guidepup).ok, true);
  assert.equal(checkExact("Guidepup", "0.34.1", SUPPORTED.guidepup).ok, false);
});

test("speech proof requires a non-empty capture containing the unique heading", () => {
  assert.equal(resultFor([]).limitation?.includes("could not prove"), true);
  assert.equal(resultFor(["loading", SUPPORTED.heading]).ok, true);
  assert.equal(resultFor([SUPPORTED.heading], new Error("cleanup failed")).ok, false);
});
