/**
 * VoiceOver's hints, and taking them out of recorded speech.
 *
 * After announcing an item VoiceOver pauses and then reads a hint: "You are
 * currently on a cell, inside of a table. To navigate the cells within this
 * table press Control-Option, and then…". Guidepup joins it to the announcement
 * with ". ", because to its polling the hint is just a later phrase.
 *
 * Whether the hint is caught depends on whether it started before Guidepup
 * decided the announcement was finished, and that is a race. On 2026-09-19 two
 * runs moved to the same cell by the same keys, and one recorded the hint and
 * the other did not. An exact snapshot cannot survive that, so the hint goes.
 *
 * What is lost is small. A hint restates the role the announcement already
 * gave, plus instructions that come from VoiceOver's verbosity setting rather
 * than from the page. The target says in its environment stamp that hints were
 * stripped, so a transcript never looks more complete than it is.
 *
 * Two consequences to know about:
 *
 * - A capture that was *only* a hint becomes empty, and is recorded as silence.
 * - Page text that itself says "You are currently on…" or "You are currently
 *   in…" is cut from there. Nothing can tell it from a hint, since both arrive
 *   as speech.
 */
const HINT = /(?:\. )?You are currently (?:on|in) [\s\S]*$/;

export function stripHint(phrase: string): string {
  return phrase.replace(HINT, "");
}
