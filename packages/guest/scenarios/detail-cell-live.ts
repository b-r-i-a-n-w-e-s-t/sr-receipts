/**
 * The expandable detail as a cell of its own row, on the live component.
 *
 * `detail-placement` measured this shape on static fixtures and is tied to them:
 * it opens details with the fixtures' own "Expand all" button and asserts on the
 * fixtures' panel text. This scenario asks the same questions of a real
 * `ColumnList` page, where the only way to open a detail is the row's own caret,
 * so it walks to the Expand column and presses Enter there.
 *
 * What it is here to hear:
 *
 * - The `T` framing before and after opening three details. The row count must
 *   not change, and the column count includes the `Details` column both times.
 * - Arriving at the last column of a collapsed row: the header name and nothing
 *   after it.
 * - Arriving at the last column of an expanded row: the header name, then the
 *   panel.
 * - Walking down the `Details` column through expanded and collapsed rows.
 * - A linear read-through past an expanded row.
 *
 * The walks are longer than any rendering of the table is wide, so they run off
 * the end at every window size and the edge announcement is itself evidence.
 *
 * `focusCheckEvery: 2`, because this scenario sends `Enter`.
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  name: "detail-cell-live",
  description:
    "The detail cell on a live ColumnList: row count across opening three details by their own carets, and what is said on arriving at the Details column collapsed and expanded.",

  modeProbes: ["moveToNextTable"],
  focusCheckEvery: 2,

  steps: [
    { label: "title bar", perform: "reportTitle", expect: { not: { silent: true } } },
    { label: "focus and mode", perform: "reportCurrentFocus", expect: { includes: "document" } },

    // ---------------------------------------------------- nothing expanded
    {
      label: "T table framing, 0 expanded",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    { label: "arrow down to enter the table", press: "ArrowDown", expect: { matches: "row \\d+, column \\d+" } },
    { label: "ctrl+alt+down to the first data row", perform: "moveToNextRow" },
    { label: "collapsed walk: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 17 },

    // ---------------------------------------------------- open three details
    { label: "ctrl+home to top", press: "Control+Home" },
    { label: "T to the table, to expand", perform: "moveToNextTable" },
    { label: "arrow down to enter, to expand", press: "ArrowDown" },
    { label: "to the first data row, to expand", perform: "moveToNextRow" },
    { label: "ctrl+alt+right to the Expand column", perform: "moveToNextColumn", expect: { includes: "Expand" } },
    { label: "enter on the caret, row 1", press: "Enter", settle: 1500 },
    { label: "ctrl+alt+down to the next caret", perform: "moveToNextRow" },
    { label: "enter on the caret, row 2", press: "Enter", settle: 1500 },
    { label: "ctrl+alt+down to the next caret, again", perform: "moveToNextRow" },
    { label: "enter on the caret, row 3", press: "Enter", settle: 1500 },

    // ---------------------------------------------------- three expanded
    { label: "ctrl+home to top, again", press: "Control+Home" },
    {
      label: "T table framing, 3 expanded",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    { label: "arrow down to enter the table, again", press: "ArrowDown", expect: { matches: "row \\d+, column \\d+" } },
    { label: "ctrl+alt+down to the first data row, again", perform: "moveToNextRow" },
    { label: "expanded walk: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 17 },
    // Rows 2 and 3 are expanded, 4 and 5 are not.
    { label: "details column: ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 4 },

    // ---------------------------------------------------- linear read-through
    { label: "ctrl+home to top, for the read-through", press: "Control+Home" },
    { label: "T table framing, repeat", perform: "moveToNextTable" },
    { label: "arrow down, line {n}", press: "ArrowDown", repeat: 30 },
  ],

  checks: [
    {
      name: "the table was framed before and after expanding",
      matches: "table, with \\d+ rows and \\d+ columns",
      atLeast: 3,
    },
    {
      // Liveness for the expand. If no caret was activated the second framing is
      // a repeat of the first and proves nothing.
      name: "a caret reported itself expanded",
      matches: "expanded",
      atLeast: 1,
    },
    {
      name: "the Details column announced its header on arrival",
      matches: "Details, column \\d+",
      atLeast: 2,
    },
    {
      name: "cell navigation answered at least half the time",
      matches: "column \\d+",
      atLeast: 18,
    },
  ],
};

export default scenario;
