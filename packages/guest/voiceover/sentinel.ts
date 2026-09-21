/**
 * A sentinel phrase spoken before every step, so that what VoiceOver said in
 * answer to the step can be told from what it said before.
 *
 * Guidepup reads VoiceOver's `last phrase` and decides a step's speech is new
 * by comparing it with the phrase it recorded last. That cannot distinguish two
 * cases, and on 2026-09-19 four runs in a row showed both:
 *
 * - **Silence.** A key bound to nothing was recorded as the previous step's
 *   announcement again, because `last phrase` still held it.
 * - **A repeat.** Asked to describe one cell twice, the second answer was
 *   dropped for equalling the first, and only the description VoiceOver spoke
 *   afterwards was kept.
 *
 * Speaking a known phrase first, through VoiceOver's own `output` command,
 * makes `last phrase` something no page ever says. A silent step then leaves
 * the sentinel in place and is recorded as it, which becomes silence once the
 * sentinel is stripped; a repeated announcement differs from the sentinel and
 * is recorded whole.
 *
 * The sentinel also has to reach Guidepup's own log, or Guidepup keeps
 * comparing against the previous announcement. A captured press of Control on
 * its own does that: Control is what VoiceOver uses to stop speaking, so it
 * also cuts the sentinel short, and with `capture: "initial"` Guidepup reads
 * `last phrase` once rather than waiting for it to settle. Whether it reads the
 * sentinel or an empty string, neither equals a real announcement.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MacOSKeyCodes, voiceOver } from "@guidepup/guidepup";

const execFileAsync = promisify(execFile);

/** Words no page says, and VoiceOver reads as words rather than letters. */
export const SENTINEL = "receipts mark";

const LEADING_SENTINEL = new RegExp(`^${SENTINEL}(?:\\. |$)`);

/** Have VoiceOver speak the sentinel, and have Guidepup take note of it. */
export async function speakSentinel(): Promise<void> {
  await execFileAsync("osascript", ["-e", `tell application "VoiceOver" to output ${JSON.stringify(SENTINEL)}`]);
  await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: "initial" });
}

/** The sentinel, and the ". " Guidepup joins it on with, taken off the front. */
export function stripSentinel(phrase: string): string {
  return phrase.replace(LEADING_SENTINEL, "");
}
