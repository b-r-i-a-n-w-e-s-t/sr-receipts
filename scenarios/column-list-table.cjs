/**
 * The column-list investigation: how does a screen reader frame this table, can
 * you navigate it by cell, is the expandable detail announced once or twice, and
 * are the controls inside it reachable?
 *
 * This lived inside `runner.cjs` as `sequence()` until Phase 2. It is this rig's
 * current question, not the rig — which is exactly why it belongs in a file the
 * harness knows nothing about.
 */
module.exports = {
  name: "column-list-table",
  description:
    "Table framing, cell navigation, read-through for double announcement, and Tab reachability inside the expanded detail.",

  // This scenario is only meaningful on a target containing a table, so prove
  // browse mode with the same thing the steps depend on.
  modeProbes: ["moveToNextTable"],

  steps: [
    { label: "title bar", perform: "reportTitle" },
    { label: "focus and mode", perform: "reportCurrentFocus" },
    { label: "T table framing", perform: "moveToNextTable" },
    { label: "T again", perform: "moveToNextTable" },
    { label: "shift+T back", perform: "moveToPreviousTable" },

    // T lands the caret on the table's name or caption, which is inside the
    // table but not in a cell, and cell navigation refuses to move from there.
    // One ArrowDown enters row 1 column 1. Proven on control.html.
    { label: "arrow down to enter the table", press: "ArrowDown" },
    { label: "ctrl+alt+down to first data row", perform: "moveToNextRow" },

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
    { label: "tab", press: "Tab", repeat: 8 },
  ],
};
