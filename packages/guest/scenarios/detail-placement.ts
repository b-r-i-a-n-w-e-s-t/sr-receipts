/**
 * Where does an expandable table row's detail belong?
 *
 * Five placements, one per target, judged against one hard criterion and three
 * softer ones. The hard one is **count honesty**: the announced row count must
 * equal the data-row count when nothing is expanded. The softer ones are
 * subordination (does an expanded detail announce as belonging to its row, or
 * as a peer), orientation (does arriving at it say anything but a coordinate),
 * and reachability.
 *
 * ## The core of the scenario is two steps and their delta
 *
 *   T table framing        -> "table, with N rows and M columns"
 *   expand five details
 *   T table framing again  -> "table, with N' rows and M columns"
 *
 * `N' - N` is the answer, per variant, and `N` on its own is the other half of
 * it. Ticket 04 rejected the whole "detail is its own row" family on the
 * recollection that a detail row inflates the count *even when collapsed*. That
 * is a property of how Carbon hides it, not of hiding as such, and V4 against V5
 * separates the two: same shape, one rendered while collapsed and one not.
 *
 * Chromium's accessibility tree was read first, on the host, so this run
 * confirms rather than discovers. It says 16/16 for V1, V2 and V3, 21/21 for V4,
 * and 16/21 for V5.
 *
 * ## Why the sequence is shaped the way it is
 *
 * - Every fixture starts **collapsed**, because the first framing is half the
 *   question. Five details are opened by a button before the table, which is the
 *   only variant-independent way for a scenario that can only send keys to open
 *   five at once. It is the first button in the document, so `b` reaches it.
 * - The column walk runs **twice**, once collapsed and once expanded. The
 *   collapsed walk is where a detail that is present but empty would announce
 *   itself; the expanded walk is where arriving at the detail is measured.
 * - The row walk also runs twice, once in the last column and once in column 1.
 *   A colspanned detail cell lives in column 1, so a walk down the last column
 *   would report a row-based variant as unreachable by cell navigation when it
 *   is only unreachable from that end.
 * - Eleven moves, so the walk runs off the end in every variant and the boundary
 *   announcement is itself evidence. V2 exposes one more column than the rest.
 * - The `Tab` pass is preceded by a jump to the first panel's `h4`, which closes
 *   the gap the 2026-09-10 run left open: that run started past the expanded row
 *   and never entered a panel, so tab order *into* the detail was never checked.
 * - `focusCheckEvery: 2`, because this scenario sends `Enter`. Detection happens
 *   after a step, so the default of 5 would let an activating key reach a window
 *   that stole the foreground.
 *
 * Expectations here stay target-independent, as they must: five targets share
 * this file, and the exact wording of each is a property of that target. It goes
 * to `snapshots/`.
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  name: "detail-placement",
  description:
    "Where the expandable detail goes: the row-count delta across expanding five details, plus orientation, reachability and verbosity at the detail.",

  modeProbes: ["moveToNextTable"],

  // This scenario activates a control. See the header.
  focusCheckEvery: 2,

  steps: [
    { label: "title bar", perform: "reportTitle", expect: { not: { silent: true } } },
    {
      // If this does not say "document" the run is in browser chrome, and every
      // announcement after it is about the wrong window.
      label: "focus and mode",
      perform: "reportCurrentFocus",
      expect: { includes: "document" },
    },

    // ---------------------------------------------------- nothing expanded
    {
      label: "T table framing, 0 expanded",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    // T lands the caret on the table's name, which is inside the table but not
    // in a cell, and cell navigation refuses to move from there. One ArrowDown
    // enters row 1 column 1. Proven on control.html.
    {
      label: "arrow down to enter the table",
      press: "ArrowDown",
      expect: { matches: "row \\d+, column \\d+" },
    },
    {
      label: "ctrl+alt+down to the first data row",
      perform: "moveToNextRow",
      // Silence here means cell navigation never engaged, which invalidates
      // every step after it.
      expect: { not: { silent: true } },
    },
    // Row 1 is expandable and collapsed. A placement that leaves something in
    // the cell matrix while collapsed announces it here.
    { label: "collapsed walk: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 11 },
    { label: "collapsed walk: ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 2 },

    // ---------------------------------------------------- open five details
    { label: "ctrl+home to top", press: "Control+Home" },
    {
      label: "b to the expand-all button",
      perform: "moveToNextButton",
      expect: { not: { silent: true } },
    },
    { label: "enter, open all five details", press: "Enter", settle: 2000 },

    // ---------------------------------------------------- five expanded
    { label: "ctrl+home to top, again", press: "Control+Home" },
    {
      // The delta against "T table framing, 0 expanded" is this ticket's answer.
      label: "T table framing, 5 expanded",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    {
      label: "arrow down to enter the table, again",
      press: "ArrowDown",
      expect: { matches: "row \\d+, column \\d+" },
    },
    {
      label: "ctrl+alt+down to the first data row, again",
      perform: "moveToNextRow",
      expect: { not: { silent: true } },
    },
    // Row 1 is expanded now. Whether this walk ever reaches the detail, and what
    // it says on arrival, is checks 2 and 3 of the six owed from ticket 12.
    { label: "expanded walk: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 11 },
    // Walking down a column past an expanded detail: does the caret pass through
    // it, and what is said? This walk is in the *last* column, which is past the
    // end of a colspanned detail cell, so it answers the skip-or-stop half.
    { label: "last column: ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 4 },

    // And the same walk in column 1, which is where a colspanned detail cell
    // actually is. Without this, a row-based variant reads as unreachable by
    // cell navigation when it is only unreachable from the right-hand end —
    // and reachability is the whole of V2's structural advantage.
    { label: "column 1: ctrl+home", press: "Control+Home" },
    { label: "column 1: T table framing", perform: "moveToNextTable" },
    {
      label: "column 1: arrow down into the table",
      press: "ArrowDown",
      expect: { matches: "row \\d+, column \\d+" },
    },
    { label: "column 1 walk: ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 5 },

    // ---------------------------------------------------- linear read-through
    // Where a doubled announcement of the panel shows: once as a name and once
    // as content.
    { label: "ctrl+home to top, for the read-through", press: "Control+Home" },
    { label: "T table framing, repeat", perform: "moveToNextTable" },
    { label: "arrow down, line {n}", press: "ArrowDown", repeat: 24 },

    // ---------------------------------------------------- into the panel
    // Land the caret exactly on the first expanded panel's heading, so the Tab
    // pass starts inside a detail rather than past one.
    { label: "ctrl+home to top, for the tab pass", press: "Control+Home" },
    {
      label: "4 to the first detail heading",
      perform: "moveToNextHeadingLevel4",
      expect: { not: { silent: true } },
    },
    // Runs off the end of the content and into Firefox's own toolbar, whose
    // wording changes between browser versions. Left in the snapshot on purpose:
    // that is a diff worth seeing and accepting deliberately. The address bar is
    // the exception, kept out by the NVDA target.
    { label: "tab {n}", press: "Tab", repeat: 8 },
  ],

  checks: [
    {
      // Liveness for the whole question. Three framings are asked for; a run
      // that produced fewer never got the delta this ticket exists to measure.
      name: "the table was framed at both counts",
      matches: "table, with \\d+ rows and \\d+ columns",
      atLeast: 3,
    },
    {
      // Liveness for the expand. If the button was never activated, the second
      // framing is a repeat of the first and the delta is a fiction.
      name: "the detail panel was opened and reached",
      matches: "Additional Details",
      atLeast: 1,
    },
    {
      // Cell navigation announcing nothing is the failure that produced a page
      // of plausible silences before the focus guard existed. Some silences at
      // the end are expected: both walks deliberately run off the end.
      name: "cell navigation answered at least half the time",
      matches: "column \\d+",
      atLeast: 12,
    },
    {
      // The controls inside the panel must be in the buffer. Both shapes managed
      // this in 2026-09-10; a variant that loses it has lost something that is
      // not negotiable.
      name: "the panel's link and button are announced",
      matches: "Request re-survey",
      atLeast: 1,
    },
  ],
};

export default scenario;
