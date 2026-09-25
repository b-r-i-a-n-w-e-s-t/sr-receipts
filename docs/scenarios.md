# Writing and judging scenarios

A scenario is what to ask a screen reader about a page: a sequence of the
reader's own commands and key presses, plus what must be true of the answers.
The rig knows nothing about any particular scenario, so a consuming repo keeps
its own in its own tree and points the rig at them.

This document applies to both readers. What is specific to one of them is
marked. For the words used here, see [`CONTEXT.md`](../CONTEXT.md).

## A scenario

```js
// a11y/scenarios/data-table.mjs
export default {
  reader: "nvda",                        // required: whose commands these are
  name: "data-table",
  description: "Is every cell reachable and correctly framed?",
  modeProbes: ["moveToNextTable"],       // NVDA only: how to prove browse mode here
  steps: [
    { label: "title bar", perform: "reportTitle" },
    { label: "T table framing", perform: "moveToNextTable" },
    { label: "enter the table", press: "ArrowDown" },
    { label: "ctrl+alt+right, move", perform: "moveToNextColumn", repeat: 11 },
    { label: "expand row {n}", press: "Enter", repeat: 3, settle: 1500 },
  ],
  focusCheckEvery: 1,                    // this one sends Enter; see below
};
```

The same question asked of VoiceOver is a different scenario, in VoiceOver's
commands:

```js
export default {
  reader: "voiceover",
  name: "voiceover-data-table",
  steps: [
    { label: "find the table", perform: "findNextTable" },
    { label: "interact with it", perform: "interactWithItem" },
    { label: "right along the header", perform: "moveToNext", repeat: 4 },
    { label: "down the first column", perform: "moveDown", repeat: 3 },
  ],
};
```

The full shape, with every field documented, is `Scenario` in
[`packages/host/src/protocol.ts`](../packages/host/src/protocol.ts).

- **`reader`** is `"nvda"` or `"voiceover"`, and is required. The two readers
  share 17 command names out of several hundred and navigate differently, so a
  scenario is written for one of them, and an Execution Target refuses the
  other's before it opens anything. To ask both readers the same question,
  write two scenarios with different names against the same page: a snapshot
  is named for its target and scenario, so the names are what keep the two
  baselines apart.
- **`perform`** runs one of the reader's own commands, the ones Guidepup names
  (it needs the reader's modifier key, which `press` cannot express). **`press`**
  sends a key. A step can also be written as the string `"perform:x"` or
  `"press:y"`, or as a `[label, spec]` pair.
- **`repeat`** expands to numbered steps: `{n}` in the label is replaced by the
  number, or the number is appended.
- **`settle`** waits this many milliseconds before reading what the reader
  said, for a step whose effect is not instant. Most steps do not need it.
- **`modeProbes`** (NVDA only) tells the guard how to prove browse mode on this
  kind of page. The default tries table, then heading, then landmark, so a page
  with any of those works untouched. VoiceOver has no browse mode, and a
  VoiceOver scenario that sets this does not compile.
- **`window: { width, height }`** sizes the browser before the page opens, for a
  responsive component whose question only exists at a particular width. Omit
  it and the browser opens at whatever size it likes.
- **`focusCheckEvery`** is how often, in steps, the target re-checks that its
  window still has the foreground: by default every 5 steps on NVDA, whose
  check costs a reader command, and every step on VoiceOver, whose check asks
  Safari and costs nothing. The check happens after a step, so up to
  that many keystrokes can reach a window that stole the foreground. That is
  harmless for navigation keys. A scenario that sends activating keys such as
  `Enter` should set it low, because an `Enter` into somebody else's window
  presses whatever it finds.

Scenario files are validated structurally by `npm test`, and command names are
checked before the reader opens the first target, so a typo costs a second
rather than a three-minute run ending in silences that read exactly like real
ones.

VoiceOver commands behave differently enough from their names that some are
worth knowing before writing a VoiceOver scenario: how the cursor arrived
changes what it moves by, `moveToNext` wraps at the end of a row, and one
command misfires. See the notes in
[`packages/guest/voiceover/README.md`](../packages/guest/voiceover/README.md).

## Pointing the rig at a scenario

A scenario reference is one of three things, and all three compile the same
way:

- a **name** in `packages/guest/scenarios/`,
- a **path** to a scenario file, such as one in a consuming repo,
- the **scenario object itself**, sent inline in a request from the host, for a
  host that keeps its scenarios in code.

A target is a fixture file name in `packages/guest/fixtures/`, or any `http(s)`
URL, passed through unchanged. From the command line:

```bash
node runner.ts --scenario survey
node runner.ts "http://192.168.64.1:5173/docs/column-list :: ./a11y/scenarios/data-table.mjs"
```

From the host, a request is `{ target, scenario }`; see
[`packages/host/README.md`](../packages/host/README.md).

## Scenarios that ship with the rig

| Scenario | Reader | Asks |
|---|---|---|
| `survey` | NVDA | Headings, landmarks, then Tab order. Assumes nothing about the page, so it is the one to point at a component you have not tested before. |
| `column-list-table` | NVDA | Table framing, cell navigation, double announcement on read-through, and Tab reachability inside an expanded detail. |
| `column-list-header-naming` | NVDA | Every column announces a name, walking the header row and entering a cell. |
| `column-list-overflow-header` | NVDA | The reveal-columns header announces its own name as well as its control's. Sizes its window. |
| `column-list-selection` | NVDA | Cell navigation and the selection count across selecting and deselecting rows. |
| `detail-placement` | NVDA | Where an expandable row's detail belongs: the row count before and after expanding five details, plus orientation, reachability and verbosity at the detail. |
| `detail-cell-live` | NVDA | The same questions on a live ColumnList page, where a detail opens only from its row's caret. |
| `voiceover-table-walk` | VoiceOver | A table walk built to measure how repeatable VoiceOver capture is. About the rig, not a component. |

## Deciding what fails a run

A run is judged, and the verdict is the first thing in the transcript. Three
things can fail it, and they answer different questions.

### Step expectations

What must be true of one announcement *whatever the page*. They live in the
scenario, because they are the scenario's intent:

```js
{ label: "T table framing", perform: "moveToNextTable",
  expect: { matches: "table, with \\d+ rows and \\d+ columns" } }
```

Matchers are `includes` (case-insensitive substring), `matches` (a regular
expression, as a string), `equals`, `silent`, and `not` around any of them.
Several in one object all have to hold, and an array of objects means all of
them.

### Scenario checks

Assertions across the whole transcript rather than one step, which is how a
question like "is the detail read twice?" gets asked:

```js
checks: [
  { name: "detail heading announced once, not twice",
    matches: "Additional Details", atMost: 1 },
]
```

A check counts the steps whose announcement matches, and holds it to `equals`,
`atLeast` or `atMost`. Its `name` is shown in the verdict, so write it as the
claim being made.

### Snapshots

The exact wording one target produced, committed in
`packages/guest/snapshots/<target>--<scenario>.json`. Exact wording does *not*
belong in a scenario: `equals: "Historical Structures, table, with 16 rows"`
would make that scenario runnable against one page and nothing else.

A snapshot compares only `label -> heard`. The environment stamp, timestamps,
the run id and the focus-guard block are excluded, because a snapshot that
fails on every browser update is a snapshot nobody reads. The stamp is still
recorded inside the snapshot, and a comparison reports when it changed, because
it is what *explains* a difference, and a difference is not automatically a
regression. A Firefox upgrade genuinely did change a toolbar announcement
between 155.0.1 and 156.0 while this rig was being built.

- A missing snapshot is a baseline, not a failure: the first run of a new
  target and scenario records one and passes.
- Mark a step `snapshot: false` to record it without comparing it.
- Firefox's address bar is always kept out. It reads the target's location
  aloud, which is a fact about the machine rather than the page.
- When a difference is right, accept it with `node runner.ts --update-snapshots`.

Over the wire a run chooses what happens to the guest's snapshots:
`"compare"` (the default: diff, fail on a difference, record where there is
none), `"update"` (record what was heard, and do not fail), or `"off"` (neither
read nor write, for a caller that keeps its baselines elsewhere, such as a
consuming repo's own Playwright snapshots).

## The verdict

Each request passes or fails, and the run as a whole ends in one of three
states:

| Exit code | Verdict | Means |
|---|---|---|
| 0 | PASS | Every request passed. |
| 1 | FAIL | At least one request failed an expectation, a check or its snapshot. A finding about the page. |
| 2 | broke | The run itself broke, and a question went unanswered. |

The difference between `1` and `2` matters to CI: `1` is a finding, `2` is a
rig problem. From the host, a failed run resolves with `ok: false` and a broken
one throws. Machine-readable results land in `runs/<runId>/results.json`
beside each request's transcript.

A request that could not reach the page (a guard failed, or something stole the
foreground part way through) says so in its transcript, skips its snapshot
comparison and writes no baseline, because a truncated run would otherwise
report every remaining step as removed and bury the one line that explains it.

## Reading a transcript

Every transcript starts with the exact builds that produced it: the operating
system, the browser, the reader, Guidepup and Node, plus the git blob hash of
the fixture's bytes, and on VoiceOver the reader settings the target applied.
Without that block a difference between two runs cannot be attributed, because
both a reader's phrasing and a browser's accessibility tree change between
releases.

Then comes the guard block, which says what the target checked before sending
any keys, and then one section per step, headed by its label and spec, with
what the reader said beneath it.

`(silence)` is written out, because a blank line in a transcript cannot be told
from a formatting accident. NVDA's answer is one phrase per line; VoiceOver's is
one joined string per step.
