/**
 * The VoiceOver session's sequencing, against a fake desktop.
 *
 * Nothing here starts VoiceOver or touches a browser. What is proved is the
 * order of operations and what each failure leaves behind: which checks stop
 * a start before the reader is talking, that the web content entry is bounded
 * and reports what VoiceOver said when it fails, that every command is
 * preceded by the sentinel so silence and repeats are recorded as what they
 * are, and that teardown cannot throw. Whether the real desktop behaves as
 * the fake does is what a run on the Mac is for.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage } from "@sr-receipts/host";

import { createVoiceOverSession, type VoiceOverDesktop, type VoiceOverReader } from "../lib/voiceover.ts";
import { stripHint } from "../voiceover/hints.ts";
import { stripSentinel } from "../voiceover/sentinel.ts";

const OK_CHECK = { name: "macOS", actual: "26.6.2", expected: "26.6.x", ok: true };

interface Fake extends VoiceOverDesktop {
  calls: string[];
  /** What VoiceOver says next, per call that speaks; the last repeats. */
  answers: string[];
}

function fakeDesktop(overrides: Partial<VoiceOverDesktop> = {}): Fake {
  const calls: string[] = [];
  const log: string[] = [];
  const answers: string[] = [];
  const speak = (fallback: string) => {
    log.push(answers.length ? (answers.length > 1 ? (answers.shift() as string) : (answers[0] as string)) : fallback);
  };
  let item = "";
  const reader: VoiceOverReader = {
    keyboardCommands: { findNextTable: { key: "t" }, openItemChooser: { key: "i" } },
    async perform(command) {
      calls.push(`perform ${JSON.stringify(command)}`);
      if ((command as { key: string }).key === "i") speak("On item Web Content");
      else speak(`said ${JSON.stringify(command)}`);
    },
    async press(key) {
      calls.push(`press ${key}`);
      speak(`pressed ${key}`);
    },
    async key(name) {
      calls.push(`key ${name}`);
    },
    async next() {
      calls.push("next");
      item = "Skip to main content link";
      speak("Skip to main content link");
    },
    async previous() {
      calls.push("previous");
      speak("previous item");
    },
    async type(text) {
      calls.push(`type ${text}`);
      speak("web content");
    },
    async interact() {
      calls.push("interact");
    },
    lastSpokenPhrase: async () => log.at(-1) ?? "",
    spokenPhraseLog: async () => [...log],
    itemText: async () => item,
    async clearSpokenPhraseLog() {
      log.length = 0;
    },
    async clearItemTextLog() {
      item = "";
    },
    async capture(action) {
      calls.push("capture");
      const result = await action();
      return { spokenPhrase: "receipts mark. 1 row selected", result };
    },
  };
  return {
    calls,
    answers,
    checks: () => [OK_CHECK],
    automationProblems: async () => [],
    reader,
    async start(attempts) {
      calls.push("start reader");
      attempts.push({ action: "start VoiceOver (attempt 1)", ok: true });
    },
    async stop() {
      calls.push("stop reader");
    },
    async speakSentinel() {
      calls.push("sentinel");
      log.push("receipts mark");
    },
    async activate(applicationName) {
      calls.push(`activate ${applicationName}`);
    },
    async delay() {
      // no waiting in tests
    },
    environment: () => ["macos: fake"],
    ...overrides,
  };
}

const page = (): EntryPage & { evaluated: number } => {
  const fake = {
    evaluated: 0,
    title: async () => "Component Library",
    bringToFront: async () => undefined,
    async evaluate() {
      fake.evaluated += 1;
      return undefined;
    },
  };
  return fake;
};

const session = (desktop: VoiceOverDesktop) => createVoiceOverSession({ applicationName: "Playwright" }, desktop);

test("a failing doctor check stops the start before anything is asked of the desktop", async () => {
  const desktop = fakeDesktop({
    checks: () => [OK_CHECK, { name: "VoiceOver AppleScript control", actual: "false", expected: "true", ok: false }],
    automationProblems: async () => {
      throw new Error("must not be reached");
    },
  });
  await assert.rejects(session(desktop).start(), /VoiceOver AppleScript control: false \(expected true\)/);
  assert.deepEqual(desktop.calls, []);
});

test("a terminal that may not drive the desktop never starts the reader", async () => {
  const desktop = fakeDesktop({
    automationProblems: async () => ["Accessibility (sending keystrokes): osascript is not allowed to send keystrokes. (1002)"],
  });
  await assert.rejects(session(desktop).start(), /VoiceOver was not started[\s\S]*1002/);
  assert.deepEqual(desktop.calls, []);
});

test("a reader that fails to start is stopped, and the attempts are in the transcript", async () => {
  const desktop = fakeDesktop();
  desktop.start = async (attempts) => {
    desktop.calls.push("start reader");
    attempts.push({ action: "start VoiceOver (attempt 1)", ok: false, error: "VoiceOver cannot be started\nApplication isn’t running. (-600)" });
    throw new Error("VoiceOver cannot be started");
  };
  const vo = session(desktop);
  await assert.rejects(vo.start(), /cannot be started/);
  assert.deepEqual(desktop.calls, ["start reader", "stop reader"]);
  assert.deepEqual(vo.transcript, ["start VoiceOver (attempt 1): VoiceOver cannot be started Application isn’t running. (-600)"]);
});

test("entering web content activates the browser, walks the Item Chooser, and proves arrival by the first item", async () => {
  const desktop = fakeDesktop();
  const vo = session(desktop);
  await vo.start();
  const target = page();
  const arrivedOn = await vo.enter(target);
  assert.equal(arrivedOn, "Skip to main content link");
  assert.deepEqual(desktop.calls.slice(0, 4), ["start reader", "activate Playwright", "key Control", "key Control"]);
  assert.ok(desktop.calls.includes('perform {"key":"i"}'));
  assert.ok(desktop.calls.includes("type w"));
  assert.deepEqual(desktop.calls.slice(-3), ["key Enter", "interact", "next"]);
  // The marker went in and came out again.
  assert.equal(target.evaluated, 2);
  assert.match(vo.transcript.join("\n"), /### focus guard: VoiceOver cursor in the web content, on "Skip to main content link"/);
});

test("an Item Chooser that never opens fails after a bounded number of attempts, quoting VoiceOver", async () => {
  const desktop = fakeDesktop();
  desktop.reader.perform = async () => {
    desktop.calls.push("perform");
    desktop.answers.push("toolbar");
    await desktop.reader.press("noop");
  };
  const vo = session(desktop);
  await vo.start();
  await assert.rejects(vo.enter(page()), /did not reach the web content[\s\S]*Item Chooser did not open in 10 attempts; VoiceOver last said/);
  assert.equal(desktop.calls.filter((call) => call === "perform").length, 10);
});

test("every command is preceded by the sentinel, and a command that leaves it in place is silence", async () => {
  const desktop = fakeDesktop();
  const vo = session(desktop);
  await vo.start();
  assert.equal(await vo.perform("findNextTable"), 'said {"key":"t"}');
  assert.equal(await vo.press("Tab"), "pressed Tab");
  // A key bound to nothing: VoiceOver says nothing, so the sentinel is the last phrase.
  desktop.reader.press = async () => undefined;
  assert.equal(await vo.press("F13"), "");
  assert.deepEqual(desktop.calls.filter((call) => call === "sentinel").length, 3);
  assert.deepEqual(vo.transcript.slice(1), ['findNextTable: said {"key":"t"}', "press Tab: pressed Tab", "press F13: (silence)"]);
});

test("a command VoiceOver lacks is refused before a keystroke", async () => {
  const desktop = fakeDesktop();
  const vo = session(desktop);
  await vo.start();
  await assert.rejects(async () => vo.perform("findNextTabel"), /unknown VoiceOver keyboard command: findNextTabel/);
  assert.ok(!desktop.calls.includes("sentinel"));
});

test("a captured page action is preceded by the sentinel and cleaned like any answer", async () => {
  const desktop = fakeDesktop();
  const vo = session(desktop);
  await vo.start();
  const captured = await vo.capture(async () => 7);
  assert.deepEqual(captured, { result: 7, spoken: "1 row selected" });
  assert.deepEqual(desktop.calls.slice(-2), ["sentinel", "capture"]);
});

test("hints are stripped from what is heard, and a hint alone is silence", async () => {
  const desktop = fakeDesktop();
  desktop.answers.push(
    "row 3 of 16 select row unchecked checkbox. You are currently on a checkbox, inside of a cell. To select or deselect this checkbox, press Control-Option-Space.",
    "You are currently on a heading level 1, inside of web content. To exit this web area, press Control-Option-Shift-Up Arrow.",
  );
  const vo = session(desktop);
  await vo.start();
  assert.equal(await vo.next(), "row 3 of 16 select row unchecked checkbox");
  assert.equal(await vo.next(), "");
});

test("stop cannot throw, and records why when it failed", async () => {
  const desktop = fakeDesktop({
    stop: async () => {
      throw new Error("already gone");
    },
  });
  const vo = session(desktop);
  await vo.start();
  await vo.stop();
  assert.match(vo.transcript.at(-1) ?? "", /^stop VoiceOver: already gone/);
});

test("the sentinel comes off the front of a phrase, and only the front", () => {
  assert.equal(stripSentinel("receipts mark"), "");
  assert.equal(stripSentinel("receipts mark. Expand column 2 of 9"), "Expand column 2 of 9");
  assert.equal(stripSentinel("Expand column 2 of 9"), "Expand column 2 of 9");
  assert.equal(stripSentinel("receipts marker"), "receipts marker");
});

test("a hint is recognised in every form the real reader has produced", () => {
  // Each of these was captured on 2026-09-19, by the spike or by a run.
  const cases: [string, string][] = [
    [
      "Historical Structures table 9 columns, 16 rows. You are currently on a table, inside of web content. To navigate the cells within this table press Control-Option, and then Up Arrow, Down Arrow, Left Arrow, or Right Arrow.",
      "Historical Structures table 9 columns, 16 rows",
    ],
    ["select all. You are currently on a text element, inside of a cell.", "select all"],
    ["On item main. You are currently in a VoiceOver Menu. This is a list of VoiceOver menu options.", "On item main"],
    ["row 4 of 16 select row Tudor gatehouse with spiral towers unchecked checkbox", "row 4 of 16 select row Tudor gatehouse with spiral towers unchecked checkbox"],
    ["Welcome to Guidepup.. You are currently on a button.", "Welcome to Guidepup."],
    ["You are currently on a heading level 1, inside of web content.", ""],
  ];
  for (const [heard, expected] of cases) assert.equal(stripHint(heard), expected);
});
