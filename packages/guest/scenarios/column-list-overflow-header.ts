/**
 * Does the reveal-columns header announce its name next to the control it holds?
 *
 * Q4 answered this on a fixture. Variants F and G measured a columnhead built
 * like the real one (a `role="menu"` whose trigger is a `role="menuitem"` button
 * named by hidden text), with and without a hidden column name beside it:
 *
 *   F (hidden "Columns" + control)  column 6, Columns, menu, menu item, sub Menu, Show Actions
 *   G (control alone)               column 6, menu, menu item, sub Menu, Show Actions
 *
 * F is the shape `ColumnList.svelte` now renders. This scenario is that reading
 * taken from the component rather than a hand-built copy of it, which is the one
 * Q4 conclusion still resting on a fixture.
 *
 * ## Why the window size is part of the question
 *
 * The overflow column only exists when `missingColumns.length` is non-zero, so a
 * run at the guest's own 1920x1200 desktop fits all fifteen columns of the VA
 * example and never renders the thing being measured. Measured against the dev
 * server, `/demo/va` holds a flat plateau of eleven columnheads from roughly
 * 1000 to 1200 CSS px, with the overflow header last; below about 950 and above
 * 1300 the layout changes. 1120x1000 lands content near 1105, clear of both
 * edges, so a few pixels of chrome drift cannot change what is being asked.
 *
 * This also sidesteps the iframe on `/component/ColumnList`, whose SvelteKit
 * client steals focus about 1.2s after load (ticket 16).
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  reader: "nvda",
  name: "column-list-overflow-header",
  description:
    "The reveal-columns header announces its own name as well as its control's.",

  modeProbes: ["moveToNextTable"],

  // Narrow enough that columns overflow. See the header comment.
  window: { width: 1120, height: 1000 },

  steps: [
    { label: "title bar", perform: "reportTitle", expect: { not: { silent: true } } },
    {
      label: "focus and mode",
      perform: "reportCurrentFocus",
      expect: { includes: "document" },
    },
    {
      label: "T table framing",
      perform: "moveToNextTable",
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    // T lands on the table's name, which is inside the table but not in a cell.
    // One ArrowDown enters row 1 column 1. Proven on control.html.
    {
      label: "arrow down into the header row",
      press: "ArrowDown",
      expect: { matches: "row \\d+, column \\d+" },
    },
    // Eleven columnheads at this width, so twelve moves walks the whole header
    // row and overshoots by one. The boundary announcement is the evidence that
    // the walk reached the end rather than stalling partway.
    { label: "header row: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 12 },

    // The second channel: the header announced on entering a data cell. Walk
    // back from wherever the header walk ended.
    {
      label: "ctrl+alt+down into the first data row",
      perform: "moveToNextRow",
      expect: { not: { silent: true } },
    },
    { label: "data row: ctrl+alt+left, back {n}", perform: "moveToPreviousColumn", repeat: 12 },

    // The back-walk starts *in* the overflow column and leaves it on its first
    // move, so it never enters it, and entering is what the second channel is.
    // Walking right from the left edge enters every column in turn, the
    // overflow column last.
    { label: "data row: ctrl+alt+right, forward {n}", perform: "moveToNextColumn", repeat: 11 },
  ],

  checks: [
    {
      // Liveness, and the width guard. `Show Actions` is the reveal control's
      // own name, so hearing it proves the overflow column rendered at all. If
      // the window did not size, the table fits every column, this column does
      // not exist, and the run fails here rather than quietly measuring a
      // different table.
      name: "the reveal-columns control was reached",
      matches: "Show Actions",
      atLeast: 1,
    },
    {
      // The F-versus-G result, from the component. G announces the control with
      // no column name in front of it; F puts the name first. Matching the name
      // immediately before the control is what separates them.
      name: "the overflow column announces Columns ahead of its control",
      matches: "Columns, menu",
      atLeast: 1,
    },
    {
      // The second channel, and the one ticket 08 rests on: is the header
      // announced on entering a cell of this column?
      //
      // The two channels do not agree here, which the Q4 fixture could not show
      // because its F and G probes walked only the header row. Walking the
      // header row reads the cell's contents as separate objects, so the name
      // and the control stay apart. Entering a cell reads the columnheader's
      // *computed* name, which NVDA composes from all its descendants, so the
      // hidden "Columns" and the trigger's "Show Actions" arrive concatenated:
      //
      //   header row   column 11, Columns, menu, menu item, sub Menu, Show Actions
      //   cell entry   Columns Show Actions, column 11
      //
      // That is the same composition that leaks the checkbox's name into the
      // select-all header. What the check can fairly require is that the column
      // name reaches this channel at all, which is what `aria-label` failed to
      // do. The exact composed string belongs in the snapshot, not here.
      name: "the overflow header is announced on entering its cell",
      matches: "Columns.*, column \\d+",
      atLeast: 1,
    },
    {
      // Q4's general failure, carried over from `column-list-header-naming`:
      // `aria-label` on a columnhead div leaves a column announcing position and
      // nothing else. A named column says "column 3, Last Survey" instead, and
      // an overshoot answers "Edge of table", so neither trips this.
      name: "no column announces as a bare coordinate",
      matches: "^,?\\s*column \\d+$",
      atMost: 0,
    },
    {
      // A run that never engaged cell navigation would satisfy the check above
      // vacuously, by announcing nothing at all.
      name: "cell navigation answered with named columns",
      matches: "column \\d+,",
      atLeast: 6,
    },
  ],
};

export default scenario;
