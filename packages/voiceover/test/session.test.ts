/**
 * VoiceOver as a Reader Session, against a fake Guidepup.
 *
 * Nothing here starts VoiceOver. Everything is asked through the one
 * interface a test has, with Guidepup faked at the seam where the real one
 * is: which checks stop a start before the reader is talking, that only the
 * launch race is retried and every attempt is in the transcript, that every
 * command is preceded by the sentinel so silence and repeats are answered
 * as what they are, that hints come off, and what the Entry sends. Whether
 * the real desktop behaves as the fake does is what a run on the Mac is for.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage } from "@sr-receipts/host";

import { START_ATTEMPTS, START_SETTLE_MS, createVoiceOverSession, isLaunchRace, type GuidepupVoiceOver, type VoiceOverSeams } from "../src/session.ts";

const OK_CHECK = { name: "macOS", actual: "26.6.2", expected: "26.6.x", ok: true };

interface Fake {
  calls: string[];
  /** What VoiceOver says next, per call that speaks; the last repeats. */
  answers: string[];
  /** VoiceOver's last-phrase log, which the sentinel is spoken into. */
  log: string[];
  reader: GuidepupVoiceOver;
}

function fakeGuidepup(): Fake {
  const calls: string[] = [];
  const log: string[] = [];
  const answers: string[] = [];
  const speak = (fallback: string) => {
    log.push(answers.length ? (answers.length > 1 ? (answers.shift() as string) : (answers[0] as string)) : fallback);
  };
  let item = "";
  const reader: GuidepupVoiceOver = {
    keyboardCommands: { findNextTable: { key: "t" }, openItemChooser: { key: "i" } },
    async start() {
      calls.push("start");
    },
    async stop() {
      calls.push("stop");
    },
    async perform(command) {
      const key = (command as { key?: string; keyCode?: number }).key ?? `code ${(command as { keyCode: number }).keyCode}`;
      calls.push(`perform ${key}`);
      if (key === "i") speak("On item Web Content");
      else if (key.startsWith("code")) return;
      else speak(`said ${key}`);
    },
    async press(key) {
      calls.push(`press ${key}`);
      speak(`pressed ${key}`);
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
      calls.push("clear log");
      log.length = 0;
    },
    async clearItemTextLog() {
      calls.push("clear items");
      item = "";
    },
    async capture(action) {
      calls.push("capture");
      const result = await action();
      return { spokenPhrase: "receipts mark. 1 row selected", result };
    },
  };
  return { calls, answers, log, reader };
}

function session(fake: Fake, seams: VoiceOverSeams = {}) {
  return createVoiceOverSession(
    { applicationName: "Playwright" },
    {
      reader: fake.reader,
      checks: () => [OK_CHECK],
      automationProblems: async () => [],
      async speakSentinel() {
        fake.calls.push("sentinel");
        fake.log.push("receipts mark");
      },
      activate: async (name) => void fake.calls.push(`activate ${name}`),
      delay: async (ms) => void fake.calls.push(`wait ${ms}`),
      environment: () => ["macos: fake"],
      ...seams,
    },
  );
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

test("a failing doctor check stops the start before anything is asked of the desktop", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake, {
    checks: () => [OK_CHECK, { name: "VoiceOver AppleScript control", actual: "false", expected: "true", ok: false }],
    automationProblems: async () => {
      throw new Error("must not be reached");
    },
  });
  await assert.rejects(vo.start(), /VoiceOver AppleScript control: false \(expected true\)/);
  assert.deepEqual(fake.calls, []);
});

test("a terminal that may not drive the desktop never starts the reader", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake, {
    automationProblems: async () => ["Accessibility (sending keystrokes): osascript is not allowed to send keystrokes. (1002)"],
  });
  await assert.rejects(vo.start(), /VoiceOver was not started[\s\S]*1002/);
  assert.deepEqual(fake.calls, []);
});

test("only the VoiceOver launch race counts as retryable", () => {
  assert.equal(isLaunchRace(new Error("Application isn’t running. (-600)")), true);
  assert.equal(isLaunchRace(new Error("outer", { cause: new Error("57:98: Application isn't running") })), true);
  assert.equal(isLaunchRace(new Error("osascript is not allowed to send keystrokes. (1002)")), false);
});

test("a lost launch race is retried, stopped and settled between attempts, and every attempt is in the transcript", async () => {
  const fake = fakeGuidepup();
  let attempt = 0;
  fake.reader.start = async () => {
    attempt += 1;
    fake.calls.push(`start ${attempt}`);
    if (attempt < 3) throw new Error("VoiceOver cannot be started", { cause: new Error("Application isn’t running.\n(-600)") });
  };
  const vo = session(fake);
  await vo.start();
  assert.deepEqual(fake.calls, ["start 1", "stop", `wait ${START_SETTLE_MS}`, "start 2", "stop", `wait ${START_SETTLE_MS}`, "start 3"]);
  assert.deepEqual(vo.transcript, [
    "start VoiceOver (attempt 1): VoiceOver cannot be started <- Application isn’t running. (-600)",
    "start VoiceOver (attempt 2): VoiceOver cannot be started <- Application isn’t running. (-600)",
    "start VoiceOver (attempt 3): ok",
    "start VoiceOver: ok",
  ]);
});

test("a launch that never wins the race gives up, and any other failure is not retried; neither leaves a reader running", async () => {
  const racing = fakeGuidepup();
  racing.reader.start = async () => {
    throw new Error("Application isn’t running. (-600)");
  };
  const race = session(racing);
  await assert.rejects(race.start(), /-600/);
  // One line per attempt, then the session's own.
  assert.equal(race.transcript.length, START_ATTEMPTS + 1);
  assert.equal(racing.calls.filter((call) => call === "stop").length, START_ATTEMPTS);

  const denied = fakeGuidepup();
  denied.reader.start = async () => {
    throw new Error("osascript is not allowed to send keystrokes. (1002)");
  };
  const other = session(denied);
  await assert.rejects(other.start(), /1002/);
  assert.deepEqual(other.transcript, [
    "start VoiceOver (attempt 1): osascript is not allowed to send keystrokes. (1002)",
    "start VoiceOver: failed: osascript is not allowed to send keystrokes. (1002)",
  ]);
  assert.deepEqual(denied.calls, ["stop"]);
});

test("every command is preceded by the sentinel, and a command that leaves it in place is silence", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake);
  assert.equal(await vo.perform("findNextTable"), "said t");
  assert.equal(await vo.press("Tab"), "pressed Tab");
  // A key bound to nothing: VoiceOver says nothing, so the sentinel is the last phrase.
  fake.reader.press = async () => undefined;
  assert.equal(await vo.press("F13"), "");
  assert.deepEqual(fake.calls, ["sentinel", "perform t", "sentinel", "press Tab", "sentinel"]);
  assert.deepEqual(vo.transcript, ["findNextTable: said t", "press Tab: pressed Tab", "press F13: (silence)"]);
});

test("a command VoiceOver lacks is refused before the sentinel or a keystroke, and recorded as failed", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake);
  await assert.rejects(vo.perform("findNextTabel"), /unknown VoiceOver keyboard command: findNextTabel/);
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(vo.transcript, ["findNextTabel: failed: unknown VoiceOver keyboard command: findNextTabel"]);
});

test("a captured page action is preceded by the sentinel and cleaned like any answer", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake);
  assert.deepEqual(await vo.capture(async () => 7), { result: 7, spoken: "1 row selected" });
  assert.deepEqual(fake.calls, ["sentinel", "capture"]);
  assert.deepEqual(vo.transcript, ["page action: 1 row selected"]);
});

test("hints are stripped from what is heard, and a hint alone is silence", async () => {
  const fake = fakeGuidepup();
  fake.answers.push(
    "row 3 of 16 select row unchecked checkbox. You are currently on a checkbox, inside of a cell. To select or deselect this checkbox, press Control-Option-Space.",
    "You are currently on a heading level 1, inside of web content. To exit this web area, press Control-Option-Shift-Up Arrow.",
  );
  const vo = session(fake);
  assert.equal(await vo.next(), "row 3 of 16 select row unchecked checkbox");
  assert.equal(await vo.next(), "");
});

test("the sentinel comes off the front of a phrase, and only the front", async () => {
  const cases: [string, string][] = [
    ["receipts mark. Expand column 2 of 9", "Expand column 2 of 9"],
    ["Expand column 2 of 9", "Expand column 2 of 9"],
    ["receipts marker", "receipts marker"],
  ];
  for (const [heard, expected] of cases) {
    const fake = fakeGuidepup();
    fake.answers.push(heard);
    assert.equal(await session(fake).next(), expected, heard);
  }
});

test("a hint is recognised in every form the real reader has produced", async () => {
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
  for (const [heard, expected] of cases) {
    const fake = fakeGuidepup();
    fake.answers.push(heard);
    assert.equal(await session(fake).next(), expected, heard);
  }
});

test("the Entry activates the browser and sends the stock Item Chooser sequence, without the sentinel, and its proof is in the transcript", async () => {
  const fake = fakeGuidepup();
  const vo = session(fake);
  const target = page();
  assert.equal(await vo.enter(target), "Skip to main content link");
  assert.deepEqual(fake.calls, [
    "activate Playwright",
    "perform code 59", "wait 100",
    "perform code 59", "wait 100", "perform code 53", "wait 100", "perform i",
    "perform code 59", "wait 100", "type w",
    "perform code 36", "wait 100", "interact", "wait 100",
    "clear log", "clear items", "next",
  ]);
  // The marker went in and came out again.
  assert.equal(target.evaluated, 2);
  assert.deepEqual(vo.transcript, [
    "open item chooser (attempt 1): On item Web Content",
    "item chooser search (round 1): web content",
    '### focus guard: VoiceOver cursor in the web content, on "Skip to main content link"',
  ]);
});

test("an entry that fails is reported with the transcript, and the reader's wrong words in it", async () => {
  const fake = fakeGuidepup();
  fake.answers.push("toolbar");
  const vo = session(fake);
  await vo.start();
  await assert.rejects(vo.enter(page()), /VoiceOver did not reach the page:[\s\S]*open item chooser \(attempt 10\): toolbar[\s\S]*### VOICEOVER DID NOT REACH THE PAGE\nItem Chooser did not open in 10 attempts/);
});

test("the log is cleaned like every answer, and the stamp is the Mac's", async () => {
  const fake = fakeGuidepup();
  fake.log.push("receipts mark. row 1", "receipts mark");
  const vo = session(fake);
  assert.deepEqual(await vo.spokenPhraseLog(), ["row 1", ""]);
  assert.deepEqual(await vo.environment(), ["macos: fake"]);
});
