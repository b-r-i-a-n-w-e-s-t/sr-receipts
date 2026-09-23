/**
 * Does table cell navigation survive selecting and deselecting rows?
 *
 * carbon-svelte #392 and #393: the first selection used to insert an ARIA menu in
 * the same tick as the checkbox's state change, NVDA mis-resolved its focus onto
 * that menu and went to focus mode, the count was never announced, and
 * Ctrl+Alt+Arrow answered with silence. Deselecting the last row did the same
 * thing through the list-actions menu.
 *
 * One run, one table, the same commands before and after each change of state:
 *
 *   first selection    the count is announced, focus is still the checkbox,
 *                      cell navigation answers
 *   second selection   the working case, kept as the control
 *   deselect to zero   the list tools come back, and nothing above still holds
 *
 * The target needs a table-mode ColumnList with `selectedActions` as the first
 * table on the page. `/demo/va` is one.
 *
 * `focusCheckEvery: 2`, because this scenario sends `Space`.
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  reader: "nvda",
  name: "column-list-selection",
  description:
    "Cell navigation and the selection count across selecting one row, a second, and deselecting both.",

  modeProbes: ["moveToNextTable"],
  focusCheckEvery: 2,

  steps: [
    { label: "title bar", perform: "reportTitle", expect: { not: { silent: true } } },
    { label: "focus and mode", perform: "reportCurrentFocus", expect: { includes: "document" } },
    {
      label: "T table framing",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    { label: "arrow down to enter the table", press: "ArrowDown", expect: { matches: "row \\d+, column \\d+" } },
    { label: "ctrl+alt+down to the first data row", perform: "moveToNextRow", expect: { includes: "select row" } },

    // ---------------------------------------------------- before any selection
    { label: "before: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 3, expect: { matches: "column \\d+" } },
    { label: "before: ctrl+alt+left, back {n}", perform: "moveToPreviousColumn", repeat: 3 },

    // ---------------------------------------------------- first selection
    { label: "space, first selection", press: "Space", settle: 1500, expect: { includes: "1 row selected" } },
    { label: "focus after the first selection", perform: "reportCurrentFocus", expect: { includes: "check box" } },
    { label: "after 1: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 3, expect: { matches: "column \\d+" } },
    { label: "after 1: ctrl+alt+left, back {n}", perform: "moveToPreviousColumn", repeat: 3 },
    { label: "after 1: ctrl+alt+down to the next row", perform: "moveToNextRow", expect: { includes: "select row" } },

    // ---------------------------------------------------- second selection
    { label: "space, second selection", press: "Space", settle: 1500, expect: { includes: "2 rows selected" } },
    { label: "focus after the second selection", perform: "reportCurrentFocus", expect: { includes: "check box" } },
    { label: "after 2: ctrl+alt+right", perform: "moveToNextColumn", expect: { matches: "column \\d+" } },
    { label: "after 2: ctrl+alt+left", perform: "moveToPreviousColumn" },

    // ---------------------------------------------------- deselect to zero
    { label: "space, deselect the second row", press: "Space", settle: 1500, expect: { includes: "1 row selected" } },
    { label: "ctrl+alt+up to the first row", perform: "moveToPreviousRow", expect: { includes: "select row" } },
    { label: "space, deselect the last row", press: "Space", settle: 1500, expect: { includes: "not checked" } },
    { label: "focus after deselecting to zero", perform: "reportCurrentFocus", expect: { includes: "check box" } },
    { label: "after 0: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 3, expect: { matches: "column \\d+" } },
    { label: "after 0: ctrl+alt+down", perform: "moveToNextRow", expect: { matches: "row \\d+" } },

    // ---------------------------------------------------- and select again
    // The zero-to-one transition a second time, now that the list tools have been
    // hidden and brought back once.
    { label: "after 0: ctrl+alt+left, back {n}", perform: "moveToPreviousColumn", repeat: 3 },
    { label: "space, select again from zero", press: "Space", settle: 1500, expect: { includes: "1 row selected" } },
    { label: "focus after selecting again", perform: "reportCurrentFocus", expect: { includes: "check box" } },
    { label: "after reselect: ctrl+alt+right", perform: "moveToNextColumn", expect: { matches: "column \\d+" } },
    { label: "focus and mode at end", perform: "reportCurrentFocus" },
  ],

  checks: [
    {
      name: "the selection count was announced on every change that left rows selected",
      matches: "\\d+ rows? selected",
      atLeast: 4,
    },
    {
      // #393, and the signature of the mis-resolved focus in #392.
      name: "nothing announced a menu",
      matches: "\\bmenu\\b",
      atMost: 0,
    },
    {
      // #392: in focus mode the table commands act on nothing.
      name: "no command was answered with silence",
      matches: "^\\(silence\\)$",
      atMost: 0,
    },
    {
      name: "no command fell out of the table",
      matches: "not in a table cell",
      atMost: 0,
    },
  ],
};

export default scenario;
