/**
 * Safari's half of the VoiceOver target: its own window, the way into web
 * content, and the questions that replace NVDA's `reportTitle` focus guard.
 *
 * Everything here talks to the real desktop, so none of it is unit tested. The
 * sequencing that uses it is, in `lib/voiceover-target.ts` and
 * `orchestrator.ts`, behind interfaces these functions satisfy.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MacOSKeyCodes, macOSActivate, voiceOver } from "@guidepup/guidepup";
import { errorChain } from "./evidence.ts";
import type { WindowSize } from "../lib/types.ts";

const execFileAsync = promisify(execFile);
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function osascript(script: string): Promise<string> {
  return (await execFileAsync("osascript", ["-e", script])).stdout.trim();
}

/**
 * macOS 26 announces the Item Chooser only as a generic VoiceOver menu — it
 * never speaks the words "Item Chooser". Matching on the name alone spins
 * forever against a chooser that is already open. This also matches VoiceOver's
 * other menus, which is acceptable: landing in the wrong menu then fails in
 * `chooseWebContent` with the phrase VoiceOver actually spoke.
 */
const ITEM_CHOOSER_ANNOUNCEMENT = /item chooser|voiceover menu/i;
const CHOOSER_ATTEMPTS = 5;
const SEARCH_ATTEMPTS = 3;

async function openItemChooser(): Promise<void> {
  let spoken = "";
  for (let attempt = 0; attempt < CHOOSER_ATTEMPTS; attempt += 1) {
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
    await delay(100);
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Escape }, { capture: false });
    await delay(100);
    await voiceOver.perform(voiceOver.keyboardCommands.openItemChooser, { capture: true });
    spoken = await voiceOver.lastSpokenPhrase();
    if (ITEM_CHOOSER_ANNOUNCEMENT.test(spoken)) return;
  }
  throw new Error(`Item Chooser did not open in ${CHOOSER_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
}

async function chooseWebContent(): Promise<void> {
  let spoken = "";
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
    for (const character of "web content") {
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
      await delay(100);
      await voiceOver.type(character, { capture: "initial" });
      spoken = await voiceOver.lastSpokenPhrase();
      if (spoken.toLowerCase().includes("web content")) return;
    }
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Backspace }, { capture: false });
    await delay(100);
  }
  throw new Error(`Item Chooser had no Web Content entry after ${SEARCH_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
}

/**
 * Put the VoiceOver cursor inside the front Safari window's web content.
 *
 * Guidepup Playwright's navigateToWebContent implementation uses these public
 * primitives: activate Safari, cancel, Item Chooser → Web Content, interact.
 * Do not substitute moveToNextWebSpot: it can land outside document content.
 * Every wait here is bounded: a stage timeout reports only elapsed time, while
 * these report what VoiceOver actually said.
 *
 * Returning at all is the proof of arrival: `chooseWebContent` only returns
 * once VoiceOver has spoken the Web Content entry it is about to choose.
 */
export async function enterSafariWebContent(): Promise<void> {
  await macOSActivate("Safari");
  await openItemChooser();
  await chooseWebContent();
  await voiceOver.perform({ keyCode: MacOSKeyCodes.Enter }, { capture: false });
  await voiceOver.interact({ capture: false });
}

/**
 * Why this process cannot drive the desktop, one line per reason; empty when it
 * can.
 *
 * The doctor cannot see either permission, and both fail badly when left to the
 * run. A first Apple event to an application raises a consent prompt, and an
 * unanswered prompt looks exactly like a hung application: the event just times
 * out. Sending keys needs the launching terminal in Privacy & Security >
 * Accessibility, and without it VoiceOver starts, Safari opens, and the first
 * keystroke fails with System Events error 1002. Asking here, before the reader
 * is talking, is the only point at which a person can still answer a prompt.
 *
 * The keystroke is a lone Control press: the same key the Item Chooser sequence
 * starts with, and it types nothing.
 */
export async function automationProblems(): Promise<string[]> {
  const asks: [string, string][] = [
    ["Automation of Safari", 'with timeout of 60 seconds\ntell application "Safari" to get name\nend timeout'],
    ["Automation of System Events", 'tell application "System Events" to get name of first process whose frontmost is true'],
    ["Accessibility (sending keystrokes)", 'tell application "System Events" to key code 59'],
  ];
  const problems: string[] = [];
  for (const [name, script] of asks) {
    try {
      await osascript(script);
    } catch (error) {
      problems.push(`${name}: ${errorChain(error).join(" <- ")}`);
    }
  }
  return problems;
}

/**
 * Open the target in a Safari window of its own and return that window's id.
 *
 * Its own window rather than a tab, so the run can size it and later close it
 * by id without touching whatever else the maintainer has open.
 */
export async function openSafariWindow(url: string, size?: WindowSize): Promise<number> {
  const bounds = size ? `\nset bounds of front window to {0, 0, ${size.width}, ${size.height}}` : "";
  const id = await osascript(
    `tell application "Safari"\nmake new document with properties {URL:${JSON.stringify(url)}}${bounds}\nget id of front window\nend tell`,
  );
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed)) throw new Error(`Safari did not report a window id; it answered ${JSON.stringify(id)}`);
  return parsed;
}

export interface SafariFront {
  /** The frontmost application, which is where keystrokes go. */
  process: string;
  /** Safari's front window, or `null` when it has none. */
  windowId: number | null;
  url: string;
}

/**
 * What has the foreground. Asks System Events and Safari rather than the
 * reader, so it types nothing and is safe to call with focus already lost.
 */
export async function safariFront(): Promise<SafariFront> {
  const process = await osascript('tell application "System Events" to get name of first process whose frontmost is true');
  const answer = await osascript(
    'tell application "Safari"\nif (count of windows) is 0 then return "none"\nreturn ((id of front window) as text) & linefeed & (URL of front document)\nend tell',
  );
  if (answer === "none") return { process, windowId: null, url: "" };
  const [id = "", url = ""] = answer.split("\n");
  return { process, windowId: Number.parseInt(id, 10), url };
}

/** Close the run's own window. A window that is already gone is not an error. */
export async function closeSafariWindow(id: number): Promise<void> {
  await osascript(`tell application "Safari" to if exists (window id ${id}) then close window id ${id}`);
}
