/**
 * The column-list investigation: how does a screen reader frame this table, can
 * you navigate it by cell, is the expandable detail announced once or twice, and
 * are the controls inside it reachable?
 *
 * This lived inside `runner.cjs` as `sequence()` until Phase 2. It is this rig's
 * current question, not the rig — which is exactly why it belongs in a file the
 * harness knows nothing about.
 */

import type { Scenario } from "../lib/types.ts";

const scenario: Scenario = {
  name: "column-list-table",
  description:
    "Table framing, cell navigation, read-through for double announcement, and Tab reachability inside the expanded detail.",

  // This scenario is only meaningful on a target containing a table, so prove
  // browse mode with the same thing the steps depend on.
  modeProbes: ["moveToNextTable"],

  // Expectations here are deliberately target-independent: they say what this
  // scenario means, not what one fixture happens to say. Exact wording lives in
  // snapshots/, because it is a property of a target rather than of the
  // question. An expectation that named "Historical Structures" would make this
  // scenario runnable against exactly one fixture.
  steps: [
    { label: "title bar", perform: "reportTitle", expect: { not: { silent: true } } },
    {
      label: "focus and mode",
      perform: "reportCurrentFocus",
      // If this does not say "document" the run is in browser chrome, and every
      // announcement after it is about the wrong thing.
      expect: { includes: "document" },
    },
    {
      label: "T table framing",
      perform: "moveToNextTable",
      // The framing announcement is the whole point of the step: a table that
      // does not announce its dimensions is not navigable as a table.
      expect: { matches: "table, with \\d+ rows and \\d+ columns" },
    },
    { label: "T again", perform: "moveToNextTable" },
    { label: "shift+T back", perform: "moveToPreviousTable" },

    // T lands the caret on the table's name or caption, which is inside the
    // table but not in a cell, and cell navigation refuses to move from there.
    // One ArrowDown enters row 1 column 1. Proven on control.html.
    {
      label: "arrow down to enter the table",
      press: "ArrowDown",
      expect: { matches: "row \\d+, column \\d+" },
    },
    {
      label: "ctrl+alt+down to first data row",
      perform: "moveToNextRow",
      // Silence here means cell navigation never engaged, which invalidates
      // every step that follows.
      expect: { not: { silent: true } },
    },

    // Walk the whole data row. G exposes 10 columns, 05 exposes 9, so 11 moves
    // run off the end in both and the boundary announcement is itself evidence.
    { label: "ctrl+alt+right, move", perform: "moveToNextColumn", repeat: 11 },
    { label: "ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 3 },
    { label: "ctrl+alt+left, back one cell", perform: "moveToPreviousColumn" },

    // Read-through from the table start, which is where double announcement of
    // the detail (name then content) would show up.
    { label: "ctrl+home to top", press: "Control+Home" },
    { label: "T table framing, repeat", perform: "moveToNextTable" },
    { label: "arrow down, line", press: "ArrowDown", repeat: 30 },

    // Tab from inside the expanded detail: are its controls reachable?
    //
    // Left in the snapshot on purpose. On the control fixture these run off the
    // end of the content and into Firefox's own toolbar, whose wording really
    // does change between browser versions — it changed between 155.0.1 and
    // 156.0 during this rig's development. That is a diff worth seeing and
    // accepting deliberately, not one worth hiding.
    { label: "tab", press: "Tab", repeat: 8 },
  ],

  checks: [
    {
      // The question this rig was built to answer. The detail panel's heading
      // must be announced once during the read-through; twice means the panel
      // is being read as both a name and as content.
      name: "detail heading announced once, not twice",
      matches: "Additional Details",
      atMost: 1,
    },
    {
      // Cell navigation announcing nothing is the failure that produced a page
      // of plausible silences before the Phase 1 guard existed. A handful of
      // silences at the end are expected — the row walk deliberately runs off
      // the end of the table — but a mostly-silent transcript is a broken run.
      name: "cell navigation answered at least half the time",
      matches: "column \\d+",
      atLeast: 6,
    },
  ],
};

export default scenario;
