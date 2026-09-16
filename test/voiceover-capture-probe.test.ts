import assert from "node:assert/strict";
import test from "node:test";
import { probeCapture, redactHome, VOICEOVER_SCRIPTS, type CaptureProbeDriver } from "../voiceover/capture-probe.ts";

function driverFor(overrides: Partial<CaptureProbeDriver> & { calls?: string[] } = {}): CaptureProbeDriver {
  const calls = overrides.calls ?? [];
  return {
    start: async () => { calls.push("start"); },
    stop: async () => { calls.push("stop"); },
    clearSpokenPhraseLog: async () => { calls.push("clear"); },
    lastSpokenPhrase: async () => "",
    spokenPhraseLog: async () => [""],
    itemText: async () => "",
    next: async () => { calls.push("next"); },
    runAppleScript: async () => "",
    ...overrides,
  };
}

test("the probe queries capture before and after the reader moves", async () => {
  const calls: string[] = [];
  const report = await probeCapture(driverFor({ calls }));
  assert.deepEqual(calls, ["start", "clear", "next", "stop"]);
  assert.deepEqual(report.queries.map((query) => query.after), [
    "start VoiceOver with capture",
    "clear spoken phrase log",
    "move the VoiceOver cursor to the next item",
  ]);
  assert.deepEqual(report.cleanup, [{ action: "stop VoiceOver", ok: true }]);
});

test("a failing capture surface is recorded, not thrown, so the other surfaces are still read", async () => {
  const report = await probeCapture(driverFor({
    lastSpokenPhrase: async () => { throw new Error("Can't get content of last phrase. (-1728)"); },
    itemText: async () => "heading",
  }));
  const [first] = report.queries;
  assert.equal(first?.lastSpokenPhrase.ok, false);
  assert.equal(first?.lastSpokenPhrase.ok === false && first.lastSpokenPhrase.error, "Can't get content of last phrase. (-1728)");
  assert.deepEqual(first?.spokenPhraseLog, { ok: true, value: [""] });
  assert.deepEqual(first?.itemText, { ok: true, value: "heading" });
  assert.equal(report.queries.length, 3);
});

test("each query reads Guidepup's own AppleScript directly, where Guidepup swallows the error", async () => {
  const sources: string[] = [];
  const report = await probeCapture(driverFor({
    runAppleScript: async (source) => {
      sources.push(source);
      if (source.includes("content of last phrase")) throw new Error("execution error: -1728");
      return "false";
    },
  }));
  assert.deepEqual(
    report.queries[0]?.scripts.map((script) => script.name),
    VOICEOVER_SCRIPTS.map((script) => script.name),
  );
  assert.equal(report.queries[0]?.scripts[0]?.result.ok, false);
  assert.deepEqual(report.queries[0]?.scripts[1]?.result, { ok: true, value: "false" });
  assert.equal(sources.length, VOICEOVER_SCRIPTS.length * 3);
});

test("a mid-probe failure still stops VoiceOver and keeps the failed action", async () => {
  const report = await probeCapture(driverFor({
    next: async () => { throw new Error("cursor unavailable"); },
  }));
  assert.deepEqual(report.actions.at(-1), { action: "move the VoiceOver cursor to the next item", ok: false, error: "cursor unavailable" });
  assert.equal(report.cleanup.at(-1)?.ok, true);
  assert.equal(report.queries.length, 3);
});

test("a failed start skips capture but never leaves VoiceOver running", async () => {
  const calls: string[] = [];
  const report = await probeCapture(driverFor({
    calls,
    start: async () => { throw new Error("VoiceOver did not start"); },
  }));
  assert.deepEqual(calls, ["stop"]);
  assert.deepEqual(report.queries, []);
  assert.equal(report.actions[0]?.error, "VoiceOver did not start");
  assert.deepEqual(report.cleanup, [{ action: "stop VoiceOver", ok: true }]);
});

test("a stop failure is reported rather than hidden", async () => {
  const report = await probeCapture(driverFor({
    stop: async () => { throw new Error("could not quit VoiceOver", { cause: new Error("Apple event timed out") }); },
  }));
  assert.deepEqual(report.cleanup, [{
    action: "stop VoiceOver",
    ok: false,
    error: "could not quit VoiceOver <- Apple event timed out",
  }]);
});

test("probe output redacts the maintainer's home directory", () => {
  assert.equal(redactHome("/Users/someone/Library/Caches/guidepup", "/Users/someone"), "~/Library/Caches/guidepup");
  assert.equal(redactHome("no path here", "/Users/someone"), "no path here");
});
