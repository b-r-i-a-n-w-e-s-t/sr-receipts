import assert from "node:assert/strict";
import test from "node:test";
import { checkExact, checkVersion, SUPPORTED } from "../voiceover/evidence.ts";
import { appleScriptControlCheck, expectedVoiceOverAsset, preferenceAccessCheck, voiceOverPreferenceDirectory } from "../voiceover/doctor.ts";
import { isLaunchRace, launchWithRetry, START_ATTEMPTS, START_SETTLE_MS } from "../voiceover/orchestrator.ts";
import type { Outcome } from "../voiceover/evidence.ts";

test("VoiceOver is supported only on its pinned release family", () => {
  assert.equal(checkVersion("macOS", "26.6.2", SUPPORTED.macOS).ok, true);
  assert.equal(checkVersion("macOS", "27.0", SUPPORTED.macOS).ok, false);
  assert.equal(checkExact("Guidepup", "0.34.0", SUPPORTED.guidepup).ok, true);
  assert.equal(checkExact("Guidepup", "0.33.0", SUPPORTED.guidepup).ok, false);
});

test("doctor exposes its asset and protected-preference diagnostics", () => {
  assert.match(expectedVoiceOverAsset("/tmp/cache"), /voiceover\/25\/0\.0\.1-VoiceOver4\/guidepup-voiceover-preferences-macos-26\.dmg$/);
  assert.match(voiceOverPreferenceDirectory("/Users/x"), /Group Containers\/group\.com\.apple\.VoiceOver\/Library\/Preferences$/);
  const check = preferenceAccessCheck("/definitely/not/here");
  assert.equal(check.ok, false);
  assert.match(check.actual, /not\/here/);
});

test("doctor reports AppleScript control, the prerequisite VoiceOver capture depends on", () => {
  const check = appleScriptControlCheck("/definitely/not/here/default.plist");
  assert.equal(check.name, "VoiceOver AppleScript control");
  assert.equal(check.ok, false);
  assert.match(check.actual, /no VoiceOver preferences at/);
});

test("only the VoiceOver launch race counts as retryable", () => {
  assert.equal(isLaunchRace(new Error("Application isn’t running. (-600)")), true);
  assert.equal(isLaunchRace(new Error("outer", { cause: new Error("57:98: Application isn't running") })), true);
  assert.equal(isLaunchRace(new Error("osascript is not allowed to send keystrokes. (1002)")), false);
});

test("a lost launch race is retried, stopped and settled between attempts, and disclosed", async () => {
  const record: Outcome[] = [];
  const calls: string[] = [];
  let attempt = 0;
  const start = launchWithRetry(
    async () => {
      attempt += 1;
      calls.push(`start ${attempt}`);
      if (attempt < 3) throw new Error("VoiceOver cannot be started", { cause: new Error("Application isn’t running. (-600)") });
    },
    async () => {
      calls.push("stop");
    },
    record,
    { wait: async (ms) => void calls.push(`wait ${ms}`) },
  );
  await start();
  assert.deepEqual(calls, ["start 1", "stop", `wait ${START_SETTLE_MS}`, "start 2", "stop", `wait ${START_SETTLE_MS}`, "start 3"]);
  assert.deepEqual(record.map((outcome) => outcome.ok), [false, false, true]);
  assert.match(record[0]?.error ?? "", /-600/);
});

test("a launch that never wins the race gives up, and other failures are not retried", async () => {
  const record: Outcome[] = [];
  const race = launchWithRetry(
    async () => {
      throw new Error("Application isn’t running. (-600)");
    },
    async () => undefined,
    record,
    { wait: async () => undefined },
  );
  await assert.rejects(race(), /-600/);
  assert.equal(record.length, START_ATTEMPTS);

  const other: Outcome[] = [];
  const denied = launchWithRetry(
    async () => {
      throw new Error("osascript is not allowed to send keystrokes. (1002)");
    },
    async () => undefined,
    other,
    { wait: async () => undefined },
  );
  await assert.rejects(denied(), /1002/);
  assert.equal(other.length, 1);
});
