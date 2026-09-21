/**
 * Can VoiceOver's captured speech be trusted as a baseline?
 *
 * The first VoiceOver scenario, and deliberately about the rig rather than
 * about a component. Run it several times against one fixture: the first run
 * records the snapshot and every later one is compared with it, so the rig's
 * own snapshot machinery measures how repeatable VoiceOver capture is.
 *
 * Guidepup records one joined string per captured command, deciding a phrase
 * is finished by polling until it stops changing and deciding it is new by
 * comparing it with the last one. Two things strain that technique, and both
 * are here on purpose:
 *
 * - **Hints.** "You are currently on a cell, inside of a table…" arrives after
 *   a pause, and two runs caught it on different steps. The target now strips
 *   hints (`voiceover/hints.ts`), so what the snapshot shows is whether the
 *   announcements are stable once that race is out of them.
 * - **A command VoiceOver answers with nothing.** Silence is a result this rig
 *   cares about, and what Guidepup reports for it is unknown. Moving right does
 *   not find it: VoiceOver wraps from the last column to the next row, which
 *   the walk below records. Moving up past the first row does not find it
 *   either: VoiceOver leaves the table and announces it. So the walk presses a
 *   key that is bound to nothing, straight after the one step that is known to
 *   draw no hint. Without the sentinel, four runs recorded it as the previous
 *   phrase again, "column 1, row 4", putting words in the reader's mouth. With
 *   the sentinel it was recorded as silence, and the step expects that.
 *
 * Two things are deliberately not here:
 *
 * - **The same announcement twice running.** A phrase equal to the last one is
 *   what Guidepup cannot tell from no phrase at all. The sentinel closes that
 *   by construction: the phrase Guidepup compares against is always the
 *   sentinel or nothing, so it can never equal an announcement. It cannot be
 *   measured with a VoiceOver command, because VoiceOver answers a consecutive
 *   second press of a read command with the next level of detail: VO-F3 with
 *   the item's description, VO-Shift-T with the table's dimensions. A scenario
 *   that wants those can ask twice on purpose.
 * - **`readTableColumnHeader`.** In 3 of 11 uses it answered with VoiceOver's
 *   own startup greeting and "VoiceOver Settings activity" instead of the
 *   header, and once moved the cursor out of the table. Its cause is unknown,
 *   and a step that fails one run in four cannot sit in a repeatability
 *   baseline.
 *
 * The walk itself is the sequence a spike proved: `findNextTable`, then
 * `interactWithItem`, then `moveToNext` along a row and `moveDown` down a
 * column. How the cursor got somewhere changes what VoiceOver moves by: after
 * wrapping to a new row, `moveToNext` walks the contents of a cell rather than
 * the cells, so the steps after the wrap move down instead.
 *
 * Written for `detail-v1-group-in-rowgroup.html`, whose table has nine columns.
 * Expectations stay loose, as they must while it is unknown how stable the
 * wording is; the exact wording is the snapshot's.
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  reader: "voiceover",
  name: "voiceover-table-walk",
  description:
    "A table walk that wraps a row, presses a key VoiceOver ignores and runs off the top, to measure how repeatable VoiceOver capture is.",

  steps: [
    { label: "find the table", perform: "findNextTable", expect: { matches: "table \\d+ columns, \\d+ rows" } },
    { label: "interact with it", perform: "interactWithItem", expect: { matches: "row 1 of \\d+" } },
    { label: "right along the header, move", perform: "moveToNext", repeat: 8, expect: { matches: "column \\d+ of 9" } },
    { label: "right past the last column", perform: "moveToNext", expect: { includes: "row 2 of" } },
    { label: "down the first column, move", perform: "moveDown", repeat: 2, expect: { matches: "row \\d+ of" } },
    { label: "row and column numbers", perform: "readTableRowAndColumnNumbers", expect: { matches: "column \\d+, row \\d+" } },
    // F13 is bound to nothing in macOS, Safari or this page, so VoiceOver has
    // nothing to say about it. It has to follow a step that draws no hint. After
    // a hinted step, a Guidepup that repeated the last phrase would repeat the
    // hint, the target would strip it, and the step would read as silence for
    // the wrong reason, which is what happened when this step came last.
    { label: "a key with nothing to announce", press: "F13", expect: { silent: true } },
    { label: "describe the cell", perform: "describeItem", expect: { includes: "is in the VoiceOver cursor" } },
    { label: "up the first column, move", perform: "moveUp", repeat: 3 },
    { label: "up past the first row", perform: "moveUp" },
  ],
};

export default scenario;
