import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkExact, checkVersion, containsFixtureToken, errorChain, normalizeVoiceOverText, resultFor, SUPPORTED, writeRunArtifacts } from "../voiceover/evidence.ts";
import { appleScriptControlCheck, expectedVoiceOverAsset, preferenceAccessCheck, voiceOverPreferenceDirectory } from "../voiceover/doctor.ts";
import { isLaunchRace, launchWithRetry, runVoiceOverSmoke, START_ATTEMPTS, START_SETTLE_MS, type VoiceOverDriver } from "../voiceover/orchestrator.ts";
import type { Outcome } from "../voiceover/evidence.ts";

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

test("doctor reports AppleScript control, the prerequisite VoiceOver capture depends on", () => {
  assert.equal(
    voiceOverPreferenceDirectory("/Users/someone"),
    "/Users/someone/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences",
  );
  const directory = mkdtempSync(join(tmpdir(), "voiceover-preferences-"));
  const missing = appleScriptControlCheck(join(directory, "absent.plist"));
  assert.equal(missing.ok, false);
  assert.match(missing.actual, /no VoiceOver preferences at/);

  const disabled = join(directory, "disabled.plist");
  writeFileSync(disabled, '{"SCREnableAppleScript":false}');
  assert.equal(appleScriptControlCheck(disabled).ok, false);

  const enabled = join(directory, "enabled.plist");
  writeFileSync(enabled, '{"SCREnableAppleScript":true}');
  const check = appleScriptControlCheck(enabled);
  assert.equal(check.ok, true);
  assert.equal(check.actual, "true");
});

test("speech proof requires normalized token evidence in both speech and cursor", () => {
  assert.equal(resultFor([]).limitation?.includes("could not prove"), true);
  assert.equal(normalizeVoiceOverText("Marigold Comet-48291"), "marigoldcomet48291");
  assert.equal(containsFixtureToken(["heading, Marigold Comet 48291"]), true);
  assert.equal(resultFor(["loading", SUPPORTED.heading], undefined, undefined, [SUPPORTED.heading]).ok, true);
  assert.equal(resultFor([SUPPORTED.heading], new Error("cleanup failed"), undefined, [SUPPORTED.heading]).ok, false);
});

test("failure evidence names the failed stage and preserves nested diagnostics", () => {
  const failure = new Error("could not stop VoiceOver", { cause: new Error("Apple event timed out") });
  const result = resultFor(["partial capture"], failure, "stop VoiceOver", ["partial cursor"]);
  assert.deepEqual(errorChain(failure), ["could not stop VoiceOver", "Apple event timed out"]);
  assert.equal(result.stage, "stop VoiceOver");
  assert.deepEqual(result.causes, ["could not stop VoiceOver", "Apple event timed out"]);
  assert.deepEqual(result.speech, ["partial capture"]);
});

test("a failed stage persists complete observable artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "voiceover-evidence-"));
  writeRunArtifacts(directory, { fixture: "file:///fixture.html" }, ["partial capture"], ["partial cursor"], new Error("timed out"), "enter Safari web content", [{ action: "stop VoiceOver", ok: false, error: "stop failed" }]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "speech.json"), "utf8")), ["partial capture"]);
  const result = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
  assert.equal(result.stage, "enter Safari web content");
  assert.equal(result.error, "timed out");
  assert.match(result.limitation, /enter Safari web content/);
  assert.deepEqual(result.cleanup, [{ action: "stop VoiceOver", ok: false, error: "stop failed" }]);
});

test("orchestration keeps the primary failure stage while reporting successful cleanup", async () => {
  const calls: string[] = [];
  const driver: VoiceOverDriver = {
    start: async () => { calls.push("start"); },
    stop: async () => { calls.push("stop"); },
    clearSpokenPhraseLog: async () => { calls.push("clear speech"); },
    clearItemTextLog: async () => { calls.push("clear cursor"); },
    spokenPhraseLog: async () => ["Marigold Comet 48291"],
    itemText: async () => "MarigoldComet48291",
    enterSafariWebContent: async () => { throw new Error("chooser unavailable"); },
    nextHeading: async () => { calls.push("next heading"); },
  };
  const result = await runVoiceOverSmoke(driver, {
    timeoutMs: 100,
    openFixture: async () => { calls.push("open"); },
    waitForSafari: async () => { calls.push("wait"); },
    matchesFixture: containsFixtureToken,
  });
  assert.equal(result.failedStage, "enter Safari web content");
  assert.equal(result.cleanup.find((outcome) => outcome.action === "stop VoiceOver")?.ok, true);
  assert.deepEqual(calls, ["start", "clear speech", "clear cursor", "open", "wait", "stop"]);
});

test("token-bearing speech alone does not end navigation before the cursor arrives", async () => {
  // The Item Chooser speaks the heading it is choosing, so speech can carry the
  // token while the VoiceOver cursor is still on the enclosing landmark.
  const cursorTexts = ["main", "main", SUPPORTED.heading];
  let headings = 0;
  const driver: VoiceOverDriver = {
    start: async () => undefined,
    stop: async () => undefined,
    clearSpokenPhraseLog: async () => undefined,
    clearItemTextLog: async () => undefined,
    spokenPhraseLog: async () => [`On item 1: ${SUPPORTED.heading}`],
    itemText: async () => cursorTexts.shift() ?? SUPPORTED.heading,
    enterSafariWebContent: async () => undefined,
    nextHeading: async () => { headings += 1; },
  };
  const result = await runVoiceOverSmoke(driver, {
    timeoutMs: 100,
    openFixture: async () => undefined,
    waitForSafari: async () => undefined,
    matchesFixture: containsFixtureToken,
  });
  assert.equal(headings, 3, "navigation must continue while only speech carries the token");
  assert.equal(result.failure, undefined);
  assert.equal(containsFixtureToken(result.cursor), true);
});

test("only the VoiceOver launch race counts as retryable", () => {
  assert.equal(isLaunchRace(new Error("VoiceOver got an error: Application isn\u2019t running. (-600)")), true);
  assert.equal(isLaunchRace(new Error("VoiceOver cannot be started", { cause: new Error("execution error: (-600)") })), true);
  assert.equal(isLaunchRace(new Error("Can't get content of last phrase. (-1728)")), false);
  assert.equal(isLaunchRace(new Error("not authorized to send Apple events")), false);
});

test("a lost launch race is retried, stopped and settled between attempts, and disclosed", async () => {
  const record: Outcome[] = [];
  const calls: string[] = [];
  let failures = 1;
  const start = launchWithRetry(
    async () => {
      calls.push("start");
      if (failures-- > 0) throw new Error("VoiceOver cannot be started", { cause: new Error("Application isn\u2019t running. (-600)") });
    },
    async () => { calls.push("stop"); },
    record,
    { wait: async (milliseconds) => { calls.push(`wait ${milliseconds}`); } },
  );
  await start();
  assert.deepEqual(calls, ["start", "stop", `wait ${START_SETTLE_MS}`, "start"]);
  assert.equal(record.length, 2);
  assert.equal(record[0]?.ok, false);
  assert.match(record[0]?.error ?? "", /-600/);
  // A run that needed a retry must still say so after it passes.
  assert.deepEqual(record[1], { action: "start VoiceOver (attempt 2)", ok: true });
});

test("a launch that never wins the race gives up, and other failures are not retried", async () => {
  const persistent: Outcome[] = [];
  let attempts = 0;
  await assert.rejects(launchWithRetry(
    async () => { attempts += 1; throw new Error("Application isn\u2019t running. (-600)"); },
    async () => undefined,
    persistent,
    { wait: async () => undefined },
  )(), /-600/);
  assert.equal(attempts, START_ATTEMPTS);

  const unrelated: Outcome[] = [];
  let tries = 0;
  let waits = 0;
  await assert.rejects(launchWithRetry(
    async () => { tries += 1; throw new Error("not authorized to send Apple events"); },
    async () => undefined,
    unrelated,
    { wait: async () => { waits += 1; } },
  )(), /not authorized/);
  assert.equal(waits, 0, "a non-race failure must not even pay the settle delay");
  assert.equal(tries, 1, "a real authorization failure must fail on the first attempt");
});

test("an abort during a pending start schedules a late stop instead of leaking VoiceOver", async () => {
  let resolveStart!: () => void;
  const controller = new AbortController();
  let stops = 0;
  const driver: VoiceOverDriver = {
    start: () => new Promise<void>((resolve) => { resolveStart = resolve; }),
    stop: async () => { stops += 1; },
    clearSpokenPhraseLog: async () => undefined,
    clearItemTextLog: async () => undefined,
    spokenPhraseLog: async () => [],
    itemText: async () => "",
    enterSafariWebContent: async () => undefined,
    nextHeading: async () => undefined,
  };
  const running = runVoiceOverSmoke(driver, {
    timeoutMs: 1_000,
    openFixture: async () => undefined,
    waitForSafari: async () => undefined,
    matchesFixture: containsFixtureToken,
    signal: controller.signal,
  });
  controller.abort();
  const result = await running;
  resolveStart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(result.failedStage, "interrupted");
  assert.ok(stops >= 1);
});
