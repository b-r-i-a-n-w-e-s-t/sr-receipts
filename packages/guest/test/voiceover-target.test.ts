/**
 * The VoiceOver Execution Target's sequencing, against a fake desktop.
 *
 * Nothing here starts VoiceOver or touches Safari. What is proved is the order
 * of operations and what each failure leaves behind: which checks stop a run
 * before the reader is talking, what `open` accepts as arrival, when the focus
 * watch stops a sequence, and that teardown cannot throw. Whether the real
 * desktop behaves as the fake does is what a run on the Mac is for.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { requireReader } from "../lib/execution-target.ts";
import { compileScenario } from "../lib/scenario.ts";
import { FIXTURES, resolveTarget } from "../lib/target.ts";
import { createVoiceOverTarget, type VoiceOverDesktop } from "../lib/voiceover-target.ts";
import { stripHint } from "../voiceover/hints.ts";
import { stripSentinel } from "../voiceover/sentinel.ts";
import type { SafariFront } from "../voiceover/safari.ts";

const TARGET = "http://localhost:5173/demo";
const OK_CHECK = { name: "macOS", actual: "26.6.2", expected: "26.6.x", ok: true };

const scenario = (extra: object = {}) =>
  compileScenario({
    reader: "voiceover",
    name: "vo",
    steps: ["perform:findNextTable", "perform:interactWithItem", "press:Tab"],
    ...extra,
  });

interface Fake extends VoiceOverDesktop {
  calls: string[];
  /** What `front()` answers next; defaults to the run's own window showing the target. */
  fronts: SafariFront[];
}

function fakeDesktop(overrides: Partial<VoiceOverDesktop> = {}): Fake {
  const calls: string[] = [];
  const spoken: string[] = [];
  const fronts: SafariFront[] = [];
  let nextWindow = 100;
  let currentWindow = 0;
  let currentUrl = "";
  return {
    calls,
    fronts,
    checks: () => [OK_CHECK],
    automationProblems: async () => [],
    reader: {
      keyboardCommands: { findNextTable: { key: "t" }, interactWithItem: { key: "down" } },
      perform(command: unknown) {
        spoken.push(`said ${JSON.stringify(command)}`);
      },
      press(key: string) {
        spoken.push(`pressed ${key}`);
      },
      spokenPhraseLog: async () => spoken,
    },
    async speakSentinel() {
      calls.push("sentinel");
      spoken.push("receipts mark");
    },
    async startReader(attempts) {
      calls.push("start reader");
      attempts.push({ action: "start VoiceOver (attempt 1)", ok: true });
    },
    async stopReader() {
      calls.push("stop reader");
    },
    async openWindow(url, size) {
      currentWindow = ++nextWindow;
      currentUrl = url;
      calls.push(`open window ${currentWindow} ${url}${size ? ` ${size.width}x${size.height}` : ""}`);
      return currentWindow;
    },
    async enterWebContent() {
      calls.push("enter web content");
    },
    async front() {
      return fronts.shift() ?? { process: "Safari", windowId: currentWindow, url: currentUrl };
    },
    async closeWindow(id) {
      calls.push(`close window ${id}`);
    },
    async delay(milliseconds) {
      calls.push(`delay ${milliseconds}`);
    },
    environment: () => ["macos: fake"],
    ...overrides,
  };
}

test("a failing doctor check stops the run before anything is asked of the desktop", async () => {
  const desktop = fakeDesktop({
    checks: () => [OK_CHECK, { name: "VoiceOver AppleScript control", actual: "false", expected: "true", ok: false }],
    automationProblems: async () => {
      throw new Error("must not be reached");
    },
  });
  await assert.rejects(createVoiceOverTarget(desktop).start(), /VoiceOver AppleScript control: false \(expected true\)/);
  assert.deepEqual(desktop.calls, []);
});

test("a terminal that may not drive the desktop never starts the reader", async () => {
  // Both spike runs lost to a permission failed after VoiceOver was already
  // talking. The reader holds the keyboard, so this has to be known first.
  const desktop = fakeDesktop({
    automationProblems: async () => ["Accessibility (sending keystrokes): osascript is not allowed to send keystrokes. (1002)"],
  });
  await assert.rejects(createVoiceOverTarget(desktop).start(), /VoiceOver was not started[\s\S]*1002/);
  assert.deepEqual(desktop.calls, []);
});

test("a reader that fails to start is stopped, so it cannot trip the next run", async () => {
  const desktop = fakeDesktop();
  desktop.startReader = async () => {
    desktop.calls.push("start reader");
    throw new Error("VoiceOver cannot be started");
  };
  await assert.rejects(createVoiceOverTarget(desktop).start(), /cannot be started/);
  assert.deepEqual(desktop.calls, ["start reader", "stop reader"]);
});

test("a scenario written for another reader, or in commands VoiceOver lacks, is refused", async () => {
  const session = await createVoiceOverTarget(fakeDesktop()).start();
  session.validate(scenario());

  const nvda = compileScenario({ reader: "nvda", name: "table", steps: ["perform:moveToNextTable"] });
  assert.throws(() => session.validate(nvda), /"table" is written for nvda, and this Execution Target drives voiceover/);
  assert.throws(() => requireReader(scenario(), "nvda"), /written for voiceover, and this Execution Target drives nvda/);

  const typo = compileScenario({ reader: "voiceover", steps: ["perform:findNextTabel"] });
  assert.throws(() => session.validate(typo), /unknown keyboard command "findNextTabel"/);
});

test("open gives the target its own sized window, waits, and enters web content", async () => {
  const desktop = fakeDesktop();
  const session = await createVoiceOverTarget(desktop).start();

  const opened = await session.open(TARGET, scenario({ window: { width: 1120, height: 1000 } }));
  assert.equal(opened.ok, true);
  assert.deepEqual(desktop.calls, [
    "start reader",
    `open window 101 ${TARGET} 1120x1000`,
    "delay 30000",
    "enter web content",
  ]);
  assert.match(opened.lines.join("\n"), /### VoiceOver start\nstart VoiceOver \(attempt 1\): ok/);
  assert.match(opened.lines.join("\n"), /focus guard: VoiceOver cursor in the web content/);

  // The next target closes the last one's window, and only that window. The
  // start attempts were the run's, so they are not repeated.
  const again = await session.open(TARGET, scenario());
  assert.equal(again.ok, true);
  assert.deepEqual(desktop.calls.slice(4), ["close window 101", `open window 102 ${TARGET}`, "delay 30000", "enter web content"]);
  assert.doesNotMatch(again.lines.join("\n"), /VoiceOver start/);
});

test("a start that needed a retry says so, one line per attempt", async () => {
  const desktop = fakeDesktop();
  desktop.startReader = async (attempts) => {
    attempts.push({ action: "start VoiceOver (attempt 1)", ok: false, error: "VoiceOver cannot be started\nCommand failed: /usr/bin/osascript\n57:98: Application isn’t running. (-600)\n" });
    attempts.push({ action: "start VoiceOver (attempt 2)", ok: true });
  };
  const session = await createVoiceOverTarget(desktop).start();
  const opened = await session.open(TARGET, scenario());
  assert.deepEqual(opened.lines.slice(0, 3), [
    "### VoiceOver start",
    "start VoiceOver (attempt 1): VoiceOver cannot be started Command failed: /usr/bin/osascript 57:98: Application isn’t running. (-600)",
    "start VoiceOver (attempt 2): ok",
  ]);
});

test("web content that is never reached is the whole diagnosis, and no steps run", async () => {
  const desktop = fakeDesktop({
    enterWebContent: async () => {
      throw new Error('Item Chooser had no Web Content entry after 3 attempts; VoiceOver last said "toolbar"');
    },
  });
  const session = await createVoiceOverTarget(desktop).start();
  const opened = await session.open(TARGET, scenario());
  assert.equal(opened.ok, false);
  assert.match(opened.lines.join("\n"), /WEB CONTENT NOT REACHED\n.*VoiceOver last said \\?"toolbar/);
});

test("arrival needs Safari in front, showing the target, in the run's own window", async () => {
  const cases: [SafariFront, RegExp][] = [
    [{ process: "ghostty", windowId: 101, url: TARGET }, /frontmost: ghostty/],
    [{ process: "Safari", windowId: 7, url: TARGET }, /front window: 7 /],
    [{ process: "Safari", windowId: 101, url: "http://localhost:5174/other" }, /showing http:\/\/localhost:5174\/other/],
  ];
  for (const [front, expected] of cases) {
    const desktop = fakeDesktop();
    desktop.fronts.push(front);
    const session = await createVoiceOverTarget(desktop).start();
    const opened = await session.open(TARGET, scenario());
    assert.equal(opened.ok, false);
    assert.match(opened.lines.join("\n"), /FOCUS GUARD FAILED/);
    assert.match(opened.lines.join("\n"), expected);
  }
});

test("steps record what VoiceOver said, after a sentinel each, and the foreground is checked after every one", async () => {
  const desktop = fakeDesktop();
  const session = await createVoiceOverTarget(desktop).start();
  const compiled = scenario();
  await session.open(TARGET, compiled);

  const heard: string[] = [];
  const result = await session.perform(compiled, (step) => heard.push(step.heard));
  assert.deepEqual(heard, ['said {"key":"t"}', 'said {"key":"down"}', "pressed Tab"]);
  assert.deepEqual(desktop.calls.slice(-3), ["sentinel", "sentinel", "sentinel"]);
  assert.equal(result.focusLost, undefined);
});

test("a step that leaves the sentinel in place is silence, and one that follows it is heard whole", async () => {
  const log: string[] = [];
  // What Guidepup's log holds after each step, as the real reader would leave
  // it: the sentinel alone for a silent key, the sentinel joined to the
  // announcement when polling caught both, and the announcement alone.
  const answers = ["receipts mark", "receipts mark. column 1, row 4", "column 1, row 4"];
  const desktop = fakeDesktop();
  desktop.reader = {
    keyboardCommands: { findNextTable: {}, interactWithItem: {} },
    perform: () => void log.push(answers.shift() ?? ""),
    press: () => void log.push(answers.shift() ?? ""),
    spokenPhraseLog: async () => log,
  };
  desktop.speakSentinel = async () => void log.push("receipts mark");
  const session = await createVoiceOverTarget(desktop).start();
  const compiled = scenario();
  await session.open(TARGET, compiled);

  const result = await session.perform(compiled, () => undefined);
  assert.deepEqual(result.steps.map((step) => step.heard), ["(silence)", "column 1, row 4", "column 1, row 4"]);
});

test("hints are stripped from what a step heard, and a hint alone is silence", async () => {
  const log: string[] = [];
  const answers = [
    "row 3 of 16 select row unchecked checkbox. You are currently on a checkbox, inside of a cell. To select or deselect this checkbox, press Control-Option-Space.",
    "You are currently on a heading level 1, inside of web content. To exit this web area, press Control-Option-Shift-Up Arrow.",
    "column 1, row 4",
  ];
  const desktop = fakeDesktop();
  desktop.reader = {
    keyboardCommands: { findNextTable: {}, interactWithItem: {} },
    perform: () => void log.push(answers.shift() ?? ""),
    press: () => void log.push(answers.shift() ?? ""),
    spokenPhraseLog: async () => log,
  };
  const session = await createVoiceOverTarget(desktop).start();
  const compiled = scenario();
  await session.open(TARGET, compiled);

  const result = await session.perform(compiled, () => undefined);
  assert.deepEqual(result.steps.map((step) => step.heard), [
    "row 3 of 16 select row unchecked checkbox",
    "(silence)",
    "column 1, row 4",
  ]);
});

test("a stolen foreground stops the sequence after one step and names the thief", async () => {
  const desktop = fakeDesktop();
  const session = await createVoiceOverTarget(desktop).start();
  const compiled = scenario();
  await session.open(TARGET, compiled);

  desktop.fronts.push({ process: "Notification Centre", windowId: 101, url: TARGET });
  const result = await session.perform(compiled, () => undefined);
  assert.equal(result.steps.length, 1);
  assert.equal(result.focusLost, "Notification Centre");
  assert.equal(result.focusLostAfter, 1);
});

test("another Safari window in front is a lost focus too, and a scenario can check less often", async () => {
  const desktop = fakeDesktop();
  const session = await createVoiceOverTarget(desktop).start();
  const compiled = scenario({ focusCheckEvery: 2 });
  await session.open(TARGET, compiled);

  desktop.fronts.push({ process: "Safari", windowId: 7, url: "http://localhost:5174/demo/va" });
  const result = await session.perform(compiled, () => undefined);
  assert.equal(result.steps.length, 2);
  assert.equal(result.focusLost, "another Safari window (http://localhost:5174/demo/va)");
});

test("stop closes the run's window and cannot throw", async () => {
  const desktop = fakeDesktop();
  const session = await createVoiceOverTarget(desktop).start();
  await session.open(TARGET, scenario());
  await session.stop();
  assert.deepEqual(desktop.calls.slice(-2), ["stop reader", "close window 101"]);

  const broken = fakeDesktop({
    stopReader: async () => {
      throw new Error("already gone");
    },
    closeWindow: async () => {
      throw new Error("Safari quit");
    },
  });
  const doomed = await createVoiceOverTarget(broken).start();
  await doomed.open(TARGET, scenario());
  await doomed.stop();
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
    [
      "On item main. You are currently in a VoiceOver Menu. This is a list of VoiceOver menu options.",
      "On item main",
    ],
    // No hint was caught, so there is nothing to take out.
    ["row 4 of 16 select row Tudor gatehouse with spiral towers unchecked checkbox", "row 4 of 16 select row Tudor gatehouse with spiral towers unchecked checkbox"],
    // A phrase that ends in its own full stop keeps it.
    ["Welcome to Guidepup.. You are currently on a button.", "Welcome to Guidepup."],
    ["You are currently on a heading level 1, inside of web content.", ""],
  ];
  for (const [heard, expected] of cases) assert.equal(stripHint(heard), expected);
});

test("a fixture resolves to a URL that names the file, on either platform", () => {
  // Joined as "file:///" + path, a POSIX path produced four slashes, which no
  // browser reports back, so a target could never be matched to its window.
  const { url } = resolveTarget("control.html");
  assert.equal(fileURLToPath(url), join(FIXTURES, "control.html"));
  assert.doesNotMatch(url, /^file:\/{4}/);
});
