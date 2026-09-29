/**
 * Why this process cannot drive the desktop, one line per reason; empty when
 * it can.
 *
 * The doctor cannot see either permission, and both fail badly when left to the
 * run. A first Apple event to an application raises a consent prompt, and an
 * unanswered prompt looks exactly like a hung application: the event just times
 * out. Sending keys needs the launching terminal in Privacy & Security >
 * Accessibility, and without it VoiceOver starts, the browser opens, and the
 * first keystroke fails with System Events error 1002. Asking here, before the
 * reader is talking, is the only point at which a person can still answer a
 * prompt.
 *
 * The keystroke is a lone Control press: the same key the Item Chooser
 * sequence starts with, and it types nothing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { errorChain } from "./evidence.ts";

const execFileAsync = promisify(execFile);

export async function automationProblems(): Promise<string[]> {
  const asks: [string, string][] = [
    ["Automation of System Events", 'tell application "System Events" to get name of first process whose frontmost is true'],
    ["Accessibility (sending keystrokes)", 'tell application "System Events" to key code 59'],
  ];
  const problems: string[] = [];
  for (const [name, script] of asks) {
    try {
      await execFileAsync("osascript", ["-e", script]);
    } catch (error) {
      problems.push(`${name}: ${errorChain(error).join(" <- ")}`);
    }
  }
  return problems;
}
