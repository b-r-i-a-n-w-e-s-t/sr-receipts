/**
 * VoiceOver as a Reader Session: the adapter over a fake desktop. What is
 * proved is only what the adapter adds, which is that each session call
 * reaches the desktop and leaves its line in the Transcript. The desktop's
 * own behaviour is in voiceover-desktop.test.ts, the Entry's in
 * voiceover-entry.test.ts, and the session's invariants in the host.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage } from "@sr-receipts/host";

import { createVoiceOverSession } from "../lib/voiceover.ts";
import type { VoiceOverDesktop } from "../voiceover/desktop.ts";

function fakeDesktop(): VoiceOverDesktop & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async start(record) {
      calls.push("start");
      record("start VoiceOver (attempt 1): ok");
    },
    stop: async () => void calls.push("stop"),
    activate: async (name) => void calls.push(`activate ${name}`),
    async perform(command) {
      calls.push(`perform ${command}`);
      return `said ${command}`;
    },
    async press(key) {
      calls.push(`press ${key}`);
      return "";
    },
    async next() {
      calls.push("next");
      return "row 2";
    },
    async previous() {
      calls.push("previous");
      return "row 1";
    },
    async capture(action) {
      calls.push("capture");
      return { result: await action(), spoken: "1 row selected" };
    },
    spokenPhraseLog: async () => ["a", "b"],
    clearSpokenPhraseLog: async () => void calls.push("clear"),
    chooser: {
      key: async () => undefined,
      open: async () => "On item Web Content",
      type: async () => "web content",
      choose: async () => undefined,
      firstItem: async () => "Skip to main content link",
    },
    environment: () => ["macos: fake"],
  };
}

const page: EntryPage = { title: async () => "Component Library", bringToFront: async () => undefined, evaluate: async () => undefined };

test("each call reaches the desktop, and the transcript records the start, the entry and every answer", async () => {
  const desktop = fakeDesktop();
  const vo = createVoiceOverSession({ applicationName: "Playwright" }, desktop);
  await vo.start();
  assert.equal(await vo.enter(page), "Skip to main content link");
  assert.equal(await vo.perform("findNextTable"), "said findNextTable");
  assert.equal(await vo.press("F13"), "");
  assert.equal(await vo.next(), "row 2");
  assert.deepEqual(await vo.capture(async () => 7), { result: 7, spoken: "1 row selected" });
  assert.deepEqual(await vo.spokenPhraseLog(), ["a", "b"]);
  assert.deepEqual(await vo.environment(), ["macos: fake"]);
  await vo.stop();
  assert.deepEqual(desktop.calls, ["start", "activate Playwright", "perform findNextTable", "press F13", "next", "capture", "stop"]);
  assert.deepEqual(vo.transcript, [
    "start VoiceOver (attempt 1): ok",
    "start VoiceOver: ok",
    "open item chooser (attempt 1): On item Web Content",
    "item chooser search (round 1): web content",
    '### focus guard: VoiceOver cursor in the web content, on "Skip to main content link"',
    "findNextTable: said findNextTable",
    "press F13: (silence)",
    "next: row 2",
    "page action: 1 row selected",
  ]);
});

test("a reader that fails to start leaves its attempts in the transcript, then the session's own line", async () => {
  const desktop = fakeDesktop();
  desktop.start = async (record) => {
    record("start VoiceOver (attempt 1): VoiceOver cannot be started <- Application isn’t running. (-600)");
    throw new Error("VoiceOver cannot be started");
  };
  const vo = createVoiceOverSession({ applicationName: "Playwright" }, desktop);
  await assert.rejects(vo.start(), /cannot be started/);
  assert.deepEqual(vo.transcript, [
    "start VoiceOver (attempt 1): VoiceOver cannot be started <- Application isn’t running. (-600)",
    "start VoiceOver: failed: VoiceOver cannot be started",
  ]);
});

test("an entry that fails is reported with the transcript, and the reader's wrong words in it", async () => {
  const desktop = fakeDesktop();
  desktop.chooser.open = async () => "toolbar";
  const vo = createVoiceOverSession({ applicationName: "Playwright" }, desktop);
  await vo.start();
  await assert.rejects(vo.enter(page), /VoiceOver did not reach the page:[\s\S]*open item chooser \(attempt 10\): toolbar[\s\S]*Item Chooser did not open in 10 attempts/);
});
