/**
 * The guards, against a fake desktop.
 *
 * Every expensive mistake on the rig was a guard that certified a run it
 * should have failed. These prove the opposite: the title guard fails when the
 * browser never comes to the front and names the windows that were there; the
 * document guard recovers from the hidden menu bar with F6 and nothing else;
 * and browse mode is proved by a quick-navigation answer, with the mode
 * toggled when every probe is silent, which is what every NVDA run of the
 * pivot's proof of concept needed.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MODE_PROBES, enterDocument } from "../lib/guard.ts";
import type { NvdaDesktop } from "../lib/nvda.ts";

interface Script {
  /** What `reportTitle` answers, in order; the last repeats. */
  titles?: string[];
  /** What activation reports as the foreground window, in order; defaults to `titles`. */
  foreground?: string[];
  /** What `reportCurrentFocus` answers, in order; the last repeats. */
  focus?: string[];
  /** Whether quick navigation answers, per mode toggle: index 0 before any toggle. */
  browseMode?: boolean[];
  windows?: string[];
}

interface Fake extends NvdaDesktop {
  calls: string[];
}

function fakeDesktop({ titles = ["Component Library : Component Library - Microsoft Edge"], foreground = titles, focus = ["Component Library, document, focused, read only"], browseMode = [true], windows = ["msedge: Component Library"] }: Script = {}): Fake {
  const calls: string[] = [];
  let toggles = 0;
  const answer = (list: string[], index: number) => list[Math.min(index, list.length - 1)] ?? "";
  let titleAsked = 0;
  let focusAsked = 0;
  const spoken = async (phrase: string) => phrase;
  return {
    calls,
    start: async () => undefined,
    stop: async () => undefined,
    async perform(command) {
      calls.push(command);
      if (command === "reportTitle") return answer(titles, titleAsked++);
      if (command === "reportCurrentFocus") return answer(focus, focusAsked++);
      if (command === "exitFocusMode") return "";
      if (command === "toggleBetweenBrowseAndFocusMode") {
        toggles += 1;
        return "browse mode";
      }
      if (MODE_PROBES.includes(command)) return (browseMode[Math.min(toggles, browseMode.length - 1)] ?? false) ? `${command} answered` : "";
      throw new Error(`unknown NVDA keyboard command: ${command}`);
    },
    async press(key) {
      calls.push(`press ${key}`);
      return key === "Control+Home" ? "link, Skip to main content" : "";
    },
    next: () => spoken("next"),
    previous: () => spoken("previous"),
    spokenPhraseLog: async () => [],
    clearSpokenPhraseLog: async () => undefined,
    captureBegin: async () => undefined,
    captureEnd: async () => "",
    windows: async () => windows,
    async activateBrowser() {
      calls.push("activate");
      return answer(foreground, Math.max(0, titleAsked));
    },
    environment: async () => [],
  };
}

const noDelay = async () => undefined;

/** The guard, with what it recorded, so a test can read the transcript it left. */
async function enter(desktop: Fake, options: Omit<Parameters<typeof enterDocument>[1], "delay">) {
  const lines: string[] = [];
  const outcome = await enterDocument(desktop, { ...options, delay: noDelay }, (...more) => void lines.push(...more)).then(
    (arrivedOn) => ({ ok: true as const, arrivedOn }),
    (error: Error) => ({ ok: false as const, error }),
  );
  return { ...outcome, lines };
}

test("a page in front, in the document, in browse mode passes on the first probe and ends at the top", async () => {
  const desktop = fakeDesktop();
  const entry = await enter(desktop, { pageTitle: "Component Library : Component Library" });
  assert.equal(entry.ok, true);
  assert.equal(entry.arrivedOn, "link, Skip to main content");
  assert.match(entry.lines.join("\n"), /### focus guard: in the document, in browse mode \(proved by moveToNextTable\)/);
  assert.deepEqual(desktop.calls, [
    "activate", "reportTitle", "exitFocusMode", "reportCurrentFocus",
    "press Control+Home", "moveToNextTable", "press Control+Home",
  ]);
});

test("a browser that never comes to the front fails the title guard and names the windows on screen", async () => {
  const desktop = fakeDesktop({ titles: ["Administrator: Windows PowerShell"], windows: ["WindowsTerminal: Administrator: Windows PowerShell", "msedge: Component Library"] });
  const entry = await enter(desktop, { pageTitle: "Component Library", activateAttempts: 3 });
  assert.equal(entry.ok, false);
  assert.match(entry.error?.message ?? "", /^FOCUS GUARD FAILED: the browser is not in front/);
  assert.equal(desktop.calls.filter((call) => call === "activate").length, 3);
  assert.match(entry.lines.join("\n"), /### windows on screen\nWindowsTerminal: Administrator: Windows PowerShell\nmsedge: Component Library/);
  // Nothing past the title guard ran: no F6, no probe.
  assert.ok(!desktop.calls.includes("press F6"));
  assert.ok(!desktop.calls.includes("moveToNextTable"));
});

test("focus on the hidden menu bar is recovered with F6, and only F6", async () => {
  const desktop = fakeDesktop({ focus: ["menu", "tab, selected", "Component Library, document, focused"] });
  const entry = await enter(desktop, { pageTitle: "Component Library" });
  assert.equal(entry.ok, true);
  assert.deepEqual(desktop.calls.filter((call) => call.startsWith("press ") && call !== "press Control+Home"), ["press F6", "press F6"]);
  assert.match(entry.lines.join("\n"), /focus attempt 1: menu\nfocus attempt 2: tab, selected\nfocus attempt 3: Component Library, document, focused/);
});

test("focus that never reaches the document fails rather than certifying a menu", async () => {
  const desktop = fakeDesktop({ focus: ["menu"] });
  const entry = await enter(desktop, { pageTitle: "Component Library", focusAttempts: 2 });
  assert.equal(entry.ok, false);
  assert.match(entry.error?.message ?? "", /focus never reached the document/);
  // The windows on screen are recorded for the diagnosis, and nothing else after the failure.
  assert.match(entry.lines.at(-2) ?? "", /^### windows on screen$/);
  assert.ok(!desktop.calls.includes("moveToNextTable"));
});

test("focus mode is caught by silent probes, toggled, and then proved", async () => {
  // Every NVDA run of the proof of concept looked like this: in the document,
  // every probe silent, one toggle, then the table answered.
  const desktop = fakeDesktop({ browseMode: [false, true] });
  const entry = await enter(desktop, { pageTitle: "Component Library" });
  assert.equal(entry.ok, true);
  const probes = desktop.calls.filter((call) => MODE_PROBES.includes(call) || call === "toggleBetweenBrowseAndFocusMode");
  assert.deepEqual(probes, [...MODE_PROBES, "toggleBetweenBrowseAndFocusMode", "moveToNextTable"]);
  assert.match(entry.lines.join("\n"), /browse mode attempt 1, moveToNextLandmark: \(silence\)\nbrowse mode attempt 2, moveToNextTable: moveToNextTable answered/);
});

test("a mode that can never be proved fails, after every probe on every attempt", async () => {
  const desktop = fakeDesktop({ browseMode: [false] });
  const entry = await enter(desktop, { pageTitle: "Component Library", modeAttempts: 2 });
  assert.equal(entry.ok, false);
  assert.match(entry.error?.message ?? "", /browse mode could not be proved/);
  assert.equal(desktop.calls.filter((call) => MODE_PROBES.includes(call)).length, MODE_PROBES.length * 2);
});

test("a page can name its own probes, and the second one answering is enough", async () => {
  const desktop = fakeDesktop();
  const entry = await enter(desktop, { pageTitle: "Component Library", modeProbes: ["moveToNextLandmark", "moveToNextHeading"] });
  assert.equal(entry.ok, true);
  assert.match(entry.lines.join("\n"), /proved by moveToNextLandmark/);
});

test("a title NVDA speaks with its symbols as words is matched on the window title activation reports", async () => {
  // The smoke's fixture: NVDA says "less table greater" for "<table>", and
  // the spoken form never matches the page's title character for character.
  const pageTitle = "Control: native <table> (validates the rig, not the component)";
  const desktop = fakeDesktop({
    titles: ["Control: native less table greater (validates the rig, not the component) - Profile 1 - Microsoft Edge"],
    foreground: [`${pageTitle} - Profile 1 - Microsoft Edge`],
  });
  const entry = await enter(desktop, { pageTitle });
  assert.equal(entry.ok, true);
  assert.equal(desktop.calls.filter((call) => call === "activate").length, 1);

  // Without activation's answer, punctuation-free comparison still carries a
  // title whose symbols NVDA reads out: colons and dashes go, words stay.
  const spokenOnly = fakeDesktop({
    titles: ["Component Library, Component Library, Profile 1, Microsoft Edge"],
    foreground: ["(unknown)"],
  });
  assert.equal((await enter(spokenOnly, { pageTitle: "Component Library : Component Library" })).ok, true);
});

test("a page with no title is matched on the browser's name instead", async () => {
  const desktop = fakeDesktop({ titles: ["Untitled - Microsoft Edge"] });
  const entry = await enter(desktop, { pageTitle: "" });
  assert.equal(entry.ok, true);
});
