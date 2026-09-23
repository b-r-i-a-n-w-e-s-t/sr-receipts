/**
 * The NVDA Execution Target's sequencing, against a fake Windows desktop.
 *
 * Nothing here starts NVDA or Firefox. What is proved is the order of
 * operations and what each failure leaves behind: what `validate` refuses
 * before anything opens, how the focus and browse-mode guards recover, what
 * `open` accepts as arrival, and when the focus watch stops a sequence. Whether
 * the real desktop behaves as the fake does is what `nvda-smoke` on the rig is
 * for.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { compileScenario } from "../lib/scenario.ts";
import { createNvdaTarget, type WindowsDesktop } from "../lib/nvda-target.ts";
import type { NvdaScenario } from "../lib/types.ts";

const COMMANDS = [
  "reportTitle",
  "reportCurrentFocus",
  "moveToNextTable",
  "moveToNextHeading",
  "moveToNextLandmark",
  "toggleBetweenBrowseAndFocusMode",
] as const;

const FIREFOX_TITLE = "Control — Mozilla Firefox";

interface Fake extends WindowsDesktop {
  /** Desktop calls and reader actions, in order. Delays are left out. */
  calls: string[];
}

/**
 * A desktop whose reader answers each action through `answer`, which gets the
 * action (`perform:<command>` or `press:<key>`) and returns what NVDA says, or
 * nothing for silence. By default it is a page that is reached first time.
 */
function fakeDesktop(
  answer: (action: string) => string | undefined = defaultAnswer(),
  overrides: Partial<WindowsDesktop> = {},
): Fake {
  const calls: string[] = [];
  const spoken: string[] = [];
  const act = (action: string): void => {
    calls.push(action);
    const said = answer(action);
    if (said !== undefined) spoken.push(said);
  };
  return {
    calls,
    reader: {
      keyboardCommands: Object.fromEntries(COMMANDS.map((name) => [name, name])),
      perform: (command: unknown) => act(`perform:${String(command)}`),
      press: (key: string) => act(`press:${key}`),
      spokenPhraseLog: async () => [...spoken],
    },
    startReader: async () => {
      calls.push("start reader");
    },
    stopReader: async () => {
      calls.push("stop reader");
    },
    kill: (image) => {
      calls.push(`kill ${image}`);
    },
    ensureProfile: () => {
      calls.push("ensure profile");
    },
    launch: (url, window) => {
      calls.push(`launch ${url}${window ? ` ${window.width}x${window.height}` : ""}`);
    },
    activateBrowser: async () => {
      calls.push("activate browser");
    },
    windowList: () => "Firefox; Windows Update",
    delay: async () => {},
    environment: () => ["windows: fake"],
    ...overrides,
  };
}

/** Firefox has the foreground, the document has focus, and tables answer. */
function defaultAnswer(overrides: Record<string, () => string | undefined> = {}) {
  return (action: string): string | undefined => {
    const override = overrides[action];
    if (override) return override();
    if (action === "perform:reportTitle") return FIREFOX_TITLE;
    if (action === "perform:reportCurrentFocus") return "Control, document, focused, read only";
    if (action === "perform:moveToNextTable") return "Historical Structures, table, with 16 rows";
    if (action === "press:Tab") return "a link";
    return undefined;
  };
}

/** Answers the given phrases in turn, then keeps answering the last one. */
const inTurn = (...phrases: (string | undefined)[]) => {
  let n = 0;
  return () => phrases[Math.min(n++, phrases.length - 1)];
};

const scenario = (extra: Partial<NvdaScenario> = {}) =>
  compileScenario({ reader: "nvda", name: "nv", steps: ["press:Tab", "press:Tab"], ...extra });

test("a reader that fails to start is stopped, and Firefox with it", async () => {
  const desktop = fakeDesktop(undefined, {
    startReader: async () => {
      throw new Error("NVDA cannot be started");
    },
  });
  await assert.rejects(createNvdaTarget(desktop).start(), /cannot be started/);
  assert.deepEqual(desktop.calls, [
    "kill firefox.exe", "kill nvda.exe", "ensure profile", "stop reader", "kill firefox.exe",
  ]);
});

test("validate refuses another reader's scenario, an unknown step, and a misspelled mode probe, before anything opens", async () => {
  const desktop = fakeDesktop();
  const session = await createNvdaTarget(desktop).start();
  session.validate(scenario({ modeProbes: ["moveToNextHeading"] }));

  const voiceOver = compileScenario({ reader: "voiceover", name: "vo", steps: ["perform:findNextTable"] });
  assert.throws(() => session.validate(voiceOver), /"vo" is written for voiceover, and this Execution Target drives nvda/);
  assert.throws(
    () => session.validate(compileScenario({ reader: "nvda", steps: ["perform:moveToNextTabel"] })),
    /unrunnable steps/,
  );
  // The contract bug this closes: a misspelled probe used to be caught only
  // when a target opened, after NVDA had started and part way through a queue.
  assert.throws(
    () => session.validate(scenario({ modeProbes: ["moveToNextTabel" as "moveToNextTable"] })),
    /unknown NVDA keyboard command\(s\) in modeProbes: moveToNextTabel/,
  );
  assert.equal(desktop.calls.some((call) => call.startsWith("launch")), false);
});

test("a page reached first time is opened in browse mode, at the top, proved by the first probe", async () => {
  const desktop = fakeDesktop();
  const session = await createNvdaTarget(desktop).start();
  desktop.calls.length = 0;

  const opened = await session.open("http://localhost:5173/demo", scenario({ window: { width: 1120, height: 900 } }));

  assert.equal(opened.ok, true);
  assert.match(opened.lines.join("\n"), /in the document, in browse mode \(proved by moveToNextTable\)/);
  assert.deepEqual(desktop.calls, [
    "kill firefox.exe",
    "launch http://localhost:5173/demo 1120x900",
    "perform:reportTitle",
    "perform:reportCurrentFocus",
    "press:Control+Home",
    "perform:moveToNextTable",
    "press:Control+Home",
  ]);
});

test("focus on Firefox's menu bar is recovered by activating the window, then by F6", async () => {
  const desktop = fakeDesktop(
    defaultAnswer({
      "perform:reportCurrentFocus": inTurn("menu, off screen", "menu, off screen", "Control, document, focused"),
    }),
  );
  const session = await createNvdaTarget(desktop).start();
  desktop.calls.length = 0;

  const opened = await session.open("control.html", scenario());

  assert.equal(opened.ok, true);
  const recovery = desktop.calls.filter((call) => call === "activate browser" || call === "press:F6");
  assert.deepEqual(recovery, ["activate browser", "press:F6"]);
  assert.match(opened.lines.join("\n"), /focus attempt 1: menu, off screen\nfocus attempt 2: menu, off screen\nfocus attempt 3: Control, document/);
});

test("a silent probe means focus mode, so the mode is toggled and the probe tried again", async () => {
  const desktop = fakeDesktop(
    defaultAnswer({
      "perform:moveToNextTable": inTurn(undefined, "Historical Structures, table"),
    }),
  );
  const session = await createNvdaTarget(desktop).start();
  desktop.calls.length = 0;

  const opened = await session.open("control.html", scenario({ modeProbes: ["moveToNextTable"] }));

  assert.equal(opened.ok, true);
  const probes = desktop.calls.filter((call) => call.startsWith("perform:moveTo") || call.includes("toggle"));
  assert.deepEqual(probes, ["perform:moveToNextTable", "perform:toggleBetweenBrowseAndFocusMode", "perform:moveToNextTable"]);
  assert.match(opened.lines.join("\n"), /browse mode attempt 1, moveToNextTable: \(silence\)/);
});

test("a window that will not come forward fails the open and names what is on screen", async () => {
  const desktop = fakeDesktop(defaultAnswer({ "perform:reportTitle": () => "Select a time to restart" }));
  const session = await createNvdaTarget(desktop).start();
  desktop.calls.length = 0;

  const opened = await session.open("control.html", scenario());

  assert.equal(opened.ok, false);
  assert.deepEqual(opened.lines, [
    "### FOCUS FAILED", "title reported: Select a time to restart", "",
    "### windows on screen", "Firefox; Windows Update", "",
  ]);
  assert.equal(desktop.calls.includes("perform:reportCurrentFocus"), false, "the guard never runs");
});

test("a page where no probe ever answers fails the guard rather than recording silences", async () => {
  const desktop = fakeDesktop(defaultAnswer({ "perform:moveToNextTable": () => undefined }));
  const session = await createNvdaTarget(desktop).start();

  const opened = await session.open("control.html", scenario({ modeProbes: ["moveToNextTable"] }));

  assert.equal(opened.ok, false);
  assert.match(opened.lines.join("\n"), /### FOCUS GUARD FAILED[\s\S]*Sequence not run/);
  assert.equal(desktop.calls.filter((call) => call === "perform:toggleBetweenBrowseAndFocusMode").length, 3);
});

test("the focus watch stops the sequence once the foreground is stolen, and names the thief", async () => {
  const titles = inTurn(FIREFOX_TITLE, FIREFOX_TITLE, "Select a time to restart");
  const desktop = fakeDesktop(defaultAnswer({ "perform:reportTitle": titles }));
  const session = await createNvdaTarget(desktop).start();
  const tabs = scenario({ focusCheckEvery: 1, steps: ["press:Tab", "press:Tab", "press:Tab"] });
  await session.open("control.html", tabs);

  const result = await session.perform(tabs, () => {});

  assert.equal(result.focusLost, "Select a time to restart");
  assert.equal(result.focusLostAfter, 2);
  assert.equal(result.steps.length, 2);
});

test("the address bar's announcement is recorded but kept out of the snapshot", async () => {
  const desktop = fakeDesktop(
    defaultAnswer({ "press:Tab": () => "Search with Google or enter address, combo box, file: slash slash slash C:" }),
  );
  const session = await createNvdaTarget(desktop).start();
  const one = scenario({ steps: ["press:Tab"] });
  await session.open("control.html", one);

  const { steps } = await session.perform(one, () => {});

  assert.equal(steps[0]?.snapshot, false);
  assert.match(steps[0]?.heard ?? "", /enter address/);
});

test("stop never throws, and always takes Firefox down with the reader", async () => {
  const desktop = fakeDesktop(undefined, {
    stopReader: async () => {
      throw new Error("already gone");
    },
  });
  const session = await createNvdaTarget(desktop).start();
  desktop.calls.length = 0;
  await session.stop();
  assert.deepEqual(desktop.calls, ["kill firefox.exe"]);
});
