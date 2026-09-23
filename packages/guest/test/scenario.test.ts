/**
 * The scenario layer: authoring format, compilation, loading, and the shipped
 * scenarios themselves.
 *
 * None of this needs NVDA, which is the point — a consuming repo's scenario is
 * validated by `npm test` on the host rather than three minutes into a run on
 * the guest desktop.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nvda } from "@guidepup/guidepup";
import { join } from "node:path";

import { readdirSync } from "node:fs";

import { SCENARIOS, compileScenario, loadScenario } from "../lib/scenario.ts";
import { validateSteps, normalize } from "../lib/steps.ts";
import { parseQueue, slugify, DEFAULT_SCENARIO } from "../lib/target.ts";
import type { ReaderDriver } from "../lib/steps.ts";
import type { CompiledScenario, NvdaCommand, Reader, StepSpec } from "../lib/types.ts";
import { keyCodeCommands } from "@guidepup/guidepup/lib/macOS/VoiceOver/keyCodeCommands.js";

/**
 * Deliberately-invalid input, cast so it compiles.
 *
 * TypeScript now rejects most of these at author time, which is the point of
 * Phase 3.5 — but the runtime validators still have to fire, because a scenario
 * can arrive as `probe.json`, as a `.json` file under `scenarios/`, or from a
 * consuming repo that never ran tsc. Every use of this helper marks a case the
 * compiler catches for a TypeScript author and the validator catches for
 * everyone else.
 */
const invalid = <T>(value: unknown): T => value as T;

const labels = (compiled: CompiledScenario): string[] =>
  compiled.steps.map((s) => s.label);
const specs = (compiled: CompiledScenario): string[] =>
  compiled.steps.map((s) => String(s.spec));

test("the three authoring forms compile to the same step", () => {
  const forms = [
    { reader: "nvda", steps: ["perform:reportTitle"] },
    { reader: "nvda", steps: [["perform:reportTitle", "perform:reportTitle"]] },
    { reader: "nvda", steps: [{ label: "perform:reportTitle", perform: "reportTitle" }] },
  ];
  for (const form of forms) {
    const compiled = compileScenario(form);
    assert.deepEqual(compiled.steps, [
      { label: "perform:reportTitle", spec: "perform:reportTitle" },
    ]);
  }
});

test("repeat numbers labels by appending", () => {
  const compiled = compileScenario({
    reader: "nvda",
    steps: [{ label: "tab", press: "Tab", repeat: 3 }],
  });
  assert.deepEqual(labels(compiled), ["tab 1", "tab 2", "tab 3"]);
  assert.deepEqual(specs(compiled), ["press:Tab", "press:Tab", "press:Tab"]);
});

test("repeat substitutes {n} when the label says where the number goes", () => {
  const compiled = compileScenario({
    reader: "nvda",
    steps: [{ label: "ctrl+alt+down, row +{n}", perform: "moveToNextRow", repeat: 3 }],
  });
  assert.deepEqual(labels(compiled), [
    "ctrl+alt+down, row +1",
    "ctrl+alt+down, row +2",
    "ctrl+alt+down, row +3",
  ]);
});

test("repeat of 1 does not number the label", () => {
  const compiled = compileScenario({ reader: "nvda", steps: [{ label: "tab", press: "Tab" }] });
  assert.deepEqual(labels(compiled), ["tab"]);
});

test("settle rides along on every expanded step", () => {
  const compiled = compileScenario({
    reader: "nvda",
    steps: [{ label: "expand", press: "Enter", repeat: 2, settle: 1500 }],
  });
  assert.deepEqual(compiled.steps.map((s) => s.settle), [1500, 1500]);
});

test("a malformed scenario is rejected, naming the step", () => {
  const cases: [unknown, RegExp][] = [
    [{ reader: "nvda", steps: [] }, /non-empty "steps"/],
    [{ reader: "nvda", steps: [{ label: "x" }] }, /exactly one of "perform" or "press"/],
    [{ reader: "nvda", steps: [{ perform: "a", press: "b" }] }, /exactly one of "perform" or "press"/],
    [{ reader: "nvda", steps: [{ press: "Tab", repeat: 0 }] }, /"repeat" must be a positive integer/],
    [{ reader: "nvda", steps: [{ press: "Tab", repeat: 2.5 }] }, /"repeat" must be a positive integer/],
    [{ reader: "nvda", steps: [{ press: "Tab", settle: -1 }] }, /"settle" must be a non-negative/],
    [{ reader: "nvda", steps: [42] }, /expected a string, a tuple or an object/],
    [{ reader: "nvda", steps: [["only-a-label"]] }, /tuple step must be/],
    [{ reader: "nvda", steps: ["perform:x"], modeProbes: "moveToNextTable" }, /"modeProbes" must be an array/],
  ];
  for (const [scenario, expected] of cases) {
    assert.throws(() => compileScenario(scenario, "under-test"), expected);
  }
});

test("a scenario must say which reader its steps are written for", () => {
  // No default. A guessed reader would hand one reader's commands to another,
  // and the only symptom would be a transcript of silences.
  assert.throws(() => compileScenario({ steps: ["press:Tab"] }, "s"), /"reader" must be one of "nvda", "voiceover", got undefined/);
  assert.throws(() => compileScenario({ reader: "jaws", steps: ["press:Tab"] }, "s"), /got "jaws"/);

  assert.equal(compileScenario({ reader: "nvda", steps: ["press:Tab"] }).reader, "nvda");
  assert.equal(compileScenario({ reader: "voiceover", steps: ["perform:findNextTable"] }).reader, "voiceover");
});

test("mode probes are refused on a VoiceOver scenario", () => {
  // They prove NVDA's browse mode. Accepting them here would look like a guard
  // that ran, on a reader where there is nothing for it to prove.
  assert.throws(
    () => compileScenario({ reader: "voiceover", modeProbes: ["findNextTable"], steps: ["press:Tab"] }, "s"),
    /"modeProbes" prove NVDA's browse mode, which voiceover does not have/,
  );
});

test("the error names the file and the step number", () => {
  assert.throws(
    () => compileScenario({ reader: "nvda", steps: ["perform:ok", { label: "bad" }] }, "my-scenario.mjs"),
    /my-scenario\.mjs: step 2/,
  );
});

test("loadScenario resolves a bare name against scenarios/", async () => {
  const compiled = await loadScenario("survey");
  assert.equal(compiled.name, "survey");
  assert.ok(compiled.steps.length > 0);
});

test("loadScenario resolves a path, which is how a consuming repo brings its own", async () => {
  const path = join(import.meta.dirname, "..", "scenarios", "column-list-table.ts");
  const compiled = await loadScenario(path);
  assert.equal(compiled.name, "column-list-table");
});

test("loadScenario compiles a scenario handed over whole, as one arrives inline", async () => {
  const compiled = await loadScenario({ reader: "nvda", name: "inline", steps: ["perform:reportTitle"] });
  assert.equal(compiled.name, "inline");
  assert.deepEqual(compiled.steps, [{ label: "perform:reportTitle", spec: "perform:reportTitle" }]);
  await assert.rejects(loadScenario({ reader: "nvda", steps: [] }), /inline scenario: needs a non-empty/);
});

test("loadScenario explains itself when the file is not there", async () => {
  await assert.rejects(
    loadScenario("./nope/missing.ts"),
    /could not load scenario "\.\/nope\/missing.ts"/,
  );
});

/**
 * The exact sequence runner.ts ran before Phase 2, transcribed from the last
 * pre-Phase-2 transcript. If the extracted scenario ever stops producing this,
 * transcripts stop being comparable across the refactor.
 */
const PRE_PHASE_2_LABELS = [
  "title bar",
  "focus and mode",
  "T table framing",
  "T again",
  "shift+T back",
  "arrow down to enter the table",
  "ctrl+alt+down to first data row",
  ...Array.from({ length: 11 }, (_, i) => `ctrl+alt+right, move ${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `ctrl+alt+down, row +${i + 1}`),
  "ctrl+alt+left, back one cell",
  "ctrl+home to top",
  "T table framing, repeat",
  ...Array.from({ length: 30 }, (_, i) => `arrow down, line ${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `tab ${i + 1}`),
];

test("column-list-table still compiles to the sequence runner.ts used to hold", async () => {
  const compiled = await loadScenario("column-list-table");
  assert.deepEqual(labels(compiled), PRE_PHASE_2_LABELS);
  assert.equal(compiled.steps.length, 62);
});

test("every shipped scenario is runnable against the real command list", async () => {
  // The one check here that needs guidepup, though not a running NVDA: that
  // every command a shipped scenario names actually exists.
  //
  // Read from the directory rather than a list, so a scenario added tomorrow is
  // covered without anyone remembering to add it here.
  const shipped = readdirSync(SCENARIOS)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.replace(/.ts$/, ""));
  assert.ok(shipped.length >= 2, "expected the shipped scenarios to be found");
  // `voiceOver.keyboardCommands` throws unless VoiceOver is running, so its
  // scenarios are checked against the table that getter returns.
  const drivers: Record<Reader, ReaderDriver> = {
    nvda,
    voiceover: { keyboardCommands: keyCodeCommands, perform: () => {}, press: () => {} },
  };
  for (const name of shipped) {
    const compiled = await loadScenario(name);
    validateSteps(drivers[compiled.reader], compiled.steps);
    for (const probe of compiled.modeProbes ?? []) {
      assert.ok(nvda.keyboardCommands[probe], `${name}: unknown modeProbe ${probe}`);
    }
  }
});

test("validateSteps reports every bad step at once, not just the first", () => {
  const nvda: ReaderDriver = {
    keyboardCommands: { reportTitle: Symbol("t") } as unknown as Record<NvdaCommand, unknown>,
    perform: () => {},
    press: () => {},
  };
  assert.throws(
    () =>
      validateSteps(nvda, [
        { label: "fine", spec: "perform:reportTitle" },
        // Cast past the compiler: both now fail to compile for a TypeScript
        // author, and the runtime check is what catches them in JSON.
        { label: "typo", spec: invalid<StepSpec>("perform:moveToNextTabel") },
        { label: "nonsense", spec: invalid<StepSpec>("moveToNextTable") },
      ]),
    (error) =>
      /step 2 \(typo\)/.test((error as Error).message) &&
      /step 3 \(nonsense\)/.test((error as Error).message),
  );
});

test("normalize accepts what probe.json is written in", () => {
  assert.deepEqual(normalize(["title bar", "perform:reportTitle"]), {
    label: "title bar",
    spec: "perform:reportTitle",
  });
});

test("a queue line can name its scenario, and defaults when it does not", () => {
  const requests = parseQueue(
    [
      "control.html",
      "control.html :: survey",
      "http://192.168.64.1:5173/docs/column-list :: ./a11y/table.mjs",
    ].join("\n"),
  );
  assert.deepEqual(requests, [
    { target: "control.html", scenario: DEFAULT_SCENARIO },
    { target: "control.html", scenario: "survey" },
    {
      target: "http://192.168.64.1:5173/docs/column-list",
      scenario: "./a11y/table.mjs",
    },
  ]);
});

test("the default scenario is overridable, which is what --scenario does", () => {
  assert.deepEqual(parseQueue("control.html", { defaultScenario: "survey" }), [
    { target: "control.html", scenario: "survey" },
  ]);
});

test("a queue line with a scenario but no target is rejected", () => {
  assert.throws(() => parseQueue(":: survey"), /names no target/);
});

test("a transcript name survives a URL target and a path-shaped scenario name", () => {
  // Both halves of `<target>--<scenario>.txt` reach NTFS, and either can be a
  // URL or a path. Neither may smuggle a separator or a reserved character in.
  const names = [
    slugify("http://192.168.64.1:5173/docs/column-list"),
    slugify("./a11y/scenarios/data-table.mjs"),
    slugify("column-list-table"),
  ];
  for (const name of names) {
    assert.doesNotMatch(name, /[\\/:*?"<>|]/);
    assert.ok(name.length > 0);
  }
  assert.equal(slugify("!!!"), "unnamed");
});

test("a window size is optional, and survives compilation when given", async () => {
  assert.equal(compileScenario({ reader: "nvda", steps: ["perform:reportTitle"] }).window, undefined);

  const sized = compileScenario({
    reader: "nvda",
    steps: ["perform:reportTitle"],
    window: { width: 1120, height: 1000 },
  });
  assert.deepEqual(sized.window, { width: 1120, height: 1000 });
});

test("a malformed window size is rejected before NVDA starts", () => {
  const bad: [unknown, RegExp][] = [
    [{ width: 1120 }, /"window.height" must be a positive integer/],
    [{ width: 0, height: 1000 }, /"window.width" must be a positive integer/],
    [{ width: 1120.5, height: 1000 }, /"window.width" must be a positive integer/],
    [[1120, 1000], /"window" must be \{ width, height \}/],
    ["1120x1000", /"window" must be \{ width, height \}/],
  ];
  for (const [window, message] of bad) {
    assert.throws(
      () => compileScenario({ reader: "nvda", steps: ["perform:reportTitle"], window }, "sized"),
      message,
      `expected ${JSON.stringify(window)} to be rejected`,
    );
  }
});

test("column-list-overflow-header asks at a width where the column exists", async () => {
  // The scenario measures a column that only renders below a breakpoint, so a
  // width that drifted out of the 1000-1200px plateau would leave it silently
  // measuring a table with no overflow column at all.
  const compiled = await loadScenario("column-list-overflow-header");
  assert.ok(compiled.window, "the scenario must size the window");
  assert.ok(
    compiled.window.width >= 1000 && compiled.window.width <= 1200,
    `width ${compiled.window.width} is outside the plateau where columns overflow`,
  );
});
