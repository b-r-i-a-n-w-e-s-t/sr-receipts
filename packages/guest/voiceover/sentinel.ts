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
 * Guidepup notices the sentinel on its own: it is a new phrase to the next
 * command's polling, so a silent command records only the sentinel, and a
 * spoken one records the sentinel joined to the announcement with ". ".
 *
 * The sentinel used to be followed by a captured press of Control, to cut it
 * short and put it in Guidepup's log. On 2026-09-26, under Playwright's
 * WebKit, that press made VoiceOver drop the next announcement: a live region
 * announced by a page action and every typed character were recorded as the
 * sentinel alone. With the `output` command alone, or with no sentinel, the
 * page action's announcement was heard; with the press alone it was not.
 * Why the press has that effect was not established.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Words no page says, and VoiceOver reads as words rather than letters. */
export const SENTINEL = "receipts mark";

const LEADING_SENTINEL = new RegExp(`^${SENTINEL}(?:\\. |$)`);

/** Have VoiceOver speak the sentinel. */
export async function speakSentinel(): Promise<void> {
  await execFileAsync("osascript", ["-e", `tell application "VoiceOver" to output ${JSON.stringify(SENTINEL)}`]);
}

/** The sentinel, and the ". " Guidepup joins it on with, taken off the front. */
export function stripSentinel(phrase: string): string {
  return phrase.replace(LEADING_SENTINEL, "");
}
