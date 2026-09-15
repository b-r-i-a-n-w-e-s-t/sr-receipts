/**
 * A first look at any target: how is it framed, what structure does a screen
 * reader find, and what does the keyboard reach?
 *
 * Deliberately assumes nothing about the page. This is the scenario to point at
 * a component you have not tested before — run it, read the transcript, and let
 * it tell you which specific scenario is worth writing.
 *
 * Because it assumes no tables, its `modeProbes` fall back through heading and
 * landmark, which is the case the Phase 1 guard change exists for.
 */
module.exports = {
  name: "survey",
  description:
    "Structure and keyboard reachability on an unfamiliar target: headings, landmarks, then Tab order.",

  modeProbes: ["moveToNextHeading", "moveToNextLandmark", "moveToNextTable"],

  steps: [
    { label: "title bar", perform: "reportTitle" },
    { label: "focus and mode", perform: "reportCurrentFocus" },

    // The heading outline: the structure most users navigate by first.
    { label: "H heading", perform: "moveToNextHeading", repeat: 12 },

    // Landmarks, from the top again.
    { label: "ctrl+home before landmarks", press: "Control+Home" },
    { label: "D landmark", perform: "moveToNextLandmark", repeat: 8 },

    // Tables, from the top again.
    { label: "ctrl+home before tables", press: "Control+Home" },
    { label: "T table", perform: "moveToNextTable", repeat: 4 },

    // Tab order from the top of the document: what the keyboard actually
    // reaches, in what order, announced how.
    { label: "ctrl+home before tabbing", press: "Control+Home" },
    { label: "tab", press: "Tab", repeat: 20 },
  ],
};
