/**
 * Does every column announce a name, in both channels?
 *
 * Two channels carry a column's name, and a mechanism can satisfy one without
 * the other. Walking the header row asks the columnheader directly; walking a
 * data row asks whether the header is announced on cell entry, which is the
 * association that lets ticket 08 drop `prependHeader`.
 *
 * Written for Q4 of the ColumnList verification protocol: `aria-label` on a
 * columnhead div computes a correct accessible name that NVDA never speaks, so
 * a text-less utility column announces as a bare coordinate. The check below is
 * that failure, stated so a run can fail on it.
 *
 * Both walks deliberately run off the end of the table. The boundary
 * announcement is evidence that the walk reached the end rather than stalling,
 * and it costs nothing to overshoot.
 */
module.exports = {
  name: "column-list-header-naming",
  description:
    "Every column announces a name when walking the header row and when entering a cell.",

  modeProbes: ["moveToNextTable"],

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
    { label: "header row: ctrl+alt+right, move {n}", perform: "moveToNextColumn", repeat: 16 },

    // Enter the data row at whatever column the header walk ended on, then walk
    // back across it. Each move is a cell entry, which is the second channel.
    {
      label: "ctrl+alt+down into the first data row",
      perform: "moveToNextRow",
      expect: { not: { silent: true } },
    },
    { label: "data row: ctrl+alt+left, back {n}", perform: "moveToPreviousColumn", repeat: 16 },
  ],

  checks: [
    {
      // The Q4 failure exactly. `aria-label` on a columnhead div leaves both
      // channels announcing position and nothing else: "column 2" walking the
      // header row, ", column 6" entering a cell. A column named by rendered or
      // visually hidden text announces "column 3, Last Survey" instead, and an
      // overshoot answers "Edge of table", so neither trips this.
      name: "no column announces as a bare coordinate",
      matches: "^,?\\s*column \\d+$",
      atMost: 0,
    },
    {
      // Liveness. A run that never engaged cell navigation would satisfy the
      // check above vacuously, by announcing nothing at all.
      name: "cell navigation answered with named columns",
      matches: "column \\d+,",
      atLeast: 6,
    },
  ],
};
