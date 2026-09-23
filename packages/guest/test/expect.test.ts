/**
 * Expectations, scenario checks, snapshots and the verdict they produce.
 *
 * All of it runs off recorded speech, so none of it needs NVDA — which is the
 * point: the layer that decides whether a build fails is the layer that must be
 * testable without a desktop.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluate, runCheck, validateCheck } from "../lib/expect.ts";
import {
  toSnapshot,
  compareSnapshot,
  snapshotPath,
  readSnapshot,
  writeSnapshot,
} from "../lib/snapshot.ts";
import { judge, formatTranscript } from "../lib/report.ts";
import { compileScenario, loadScenario } from "../lib/scenario.ts";
import type {
  CompiledScenario,
  OpenResult,
  Snapshot,
  SnapshotComparison,
  StepResult,
} from "../lib/types.ts";

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

const TABLE = "Historical Structures, table, with 16 rows and 5 columns";

test("the matchers hold and fail as stated", () => {
  assert.deepEqual(evaluate(TABLE, { includes: "table" }), []);
  assert.deepEqual(evaluate(TABLE, { includes: "TABLE" }), [], "includes is case-insensitive");
  assert.deepEqual(evaluate(TABLE, { matches: "with \\d+ rows" }), []);
  assert.deepEqual(evaluate(TABLE, { matches: "WITH \\d+ ROWS" }), [], "matches is case-insensitive");
  assert.deepEqual(evaluate(TABLE, { equals: TABLE }), []);
  assert.deepEqual(evaluate("(silence)", { silent: true }), []);
  assert.deepEqual(evaluate(TABLE, { silent: false }), []);

  assert.equal(evaluate(TABLE, { includes: "list box" }).length, 1);
  assert.equal(evaluate(TABLE, { matches: "with \\d+ pages" }).length, 1);
  assert.equal(evaluate(TABLE, { equals: "something else" }).length, 1);
  assert.equal(evaluate(TABLE, { silent: true }).length, 1);
  assert.equal(evaluate("(silence)", { silent: false }).length, 1);
});

test("a failure quotes what was actually heard, which is what makes it readable", () => {
  const [failure = ""] = evaluate(TABLE, { includes: "list box" });
  assert.match(failure, /expected to include "list box"/);
  assert.match(failure, /heard Historical Structures/);
});

test("a very long announcement is truncated in the failure message", () => {
  const long = "x".repeat(500);
  const [failure = ""] = evaluate(long, { includes: "nope" });
  assert.ok(failure.length < 200, `failure message was ${failure.length} chars`);
  assert.match(failure, /\.\.\.$/);
});

test("multi-phrase speech is quoted on one line", () => {
  const [failure = ""] = evaluate("Description\ncolumn 2\nNorman keep", { includes: "nope" });
  assert.match(failure, /Description \/ column 2 \/ Norman keep/);
});

test("not inverts any matcher", () => {
  assert.deepEqual(evaluate(TABLE, { not: { silent: true } }), []);
  assert.deepEqual(evaluate("(silence)", { not: { includes: "table" } }), []);
  assert.equal(evaluate(TABLE, { not: { includes: "table" } }).length, 1);
});

test("every matcher in one expectation is reported, not just the first failure", () => {
  const failures = evaluate(TABLE, { includes: "list box", matches: "\\d+ pages" });
  assert.equal(failures.length, 2);
});

test("an array of expectations all have to hold", () => {
  assert.deepEqual(evaluate(TABLE, [{ includes: "table" }, { not: { silent: true } }]), []);
  assert.equal(evaluate(TABLE, [{ includes: "table" }, { includes: "nope" }]).length, 1);
});

test("no expectation is not a failing expectation", () => {
  assert.deepEqual(evaluate(TABLE, undefined), []);
  assert.deepEqual(evaluate(TABLE, null), []);
});

test("an unknown matcher is an error, not a silently passing assertion", () => {
  assert.throws(() => evaluate(TABLE, invalid({ contains: "table" })), /unknown matcher "contains"/);
});

const steps = (pairs: [string, string][]): StepResult[] =>
  pairs.map(([label, heard]) => ({ label, spec: "press:Tab", heard }));

test("a check counts the steps whose speech matches", () => {
  const result = runCheck(
    { name: "detail once", matches: "Additional Details", atMost: 1 },
    steps([
      ["line 1", "Additional Details, heading level 4"],
      ["line 2", "Architectural Features: pointed arches"],
      ["line 3", "(silence)"],
    ]),
  );
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.matchedLabels, ["line 1"]);
});

test("a check fails when the count is wrong, and says what it found", () => {
  const result = runCheck(
    { name: "detail once", matches: "Additional Details", atMost: 1 },
    steps([
      ["line 1", "Additional Details"],
      ["line 2", "Additional Details"],
    ]),
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /expected at most 1, found 2/);
  assert.deepEqual(result.matchedLabels, ["line 1", "line 2"]);
});

test("equals, atLeast and atMost combine", () => {
  const two = steps([["a", "x"], ["b", "x"]]);
  assert.equal(runCheck({ name: "n", matches: "x", equals: 2 }, two).ok, true);
  assert.equal(runCheck({ name: "n", matches: "x", atLeast: 3 }, two).ok, false);
  assert.equal(
    runCheck({ name: "n", matches: "x", atLeast: 1, atMost: 5 }, two).ok,
    true,
  );
});

test("a malformed check is rejected at compile time", () => {
  const cases: [unknown, RegExp][] = [
    [{ matches: "x", equals: 1 }, /needs a "name"/],
    [{ name: "n", equals: 1 }, /needs "matches"/],
    [{ name: "n", matches: "x" }, /needs one of equals, atLeast, atMost/],
    [{ name: "n", matches: "x", equals: -1 }, /must be a non-negative integer/],
    [{ name: "n", matches: "x", atMost: 1.5 }, /must be a non-negative integer/],
  ];
  for (const [check, expected] of cases) {
    assert.throws(() => validateCheck(check, "here"), expected);
  }
});

test("a bad matcher in a scenario is caught when the scenario compiles", () => {
  assert.throws(
    () => compileScenario({ reader: "nvda", steps: [{ press: "Tab", expect: { contains: "x" } }] }, "s"),
    /unknown matcher/,
  );
  assert.throws(
    () => compileScenario({ reader: "nvda", steps: ["press:Tab"], checks: [{ name: "n" }] }, "s"),
    /needs "matches"/,
  );
});

test("a pattern that is not a string is refused, as a RegExp sent over the wire arrives", () => {
  // JSON.stringify turns a RegExp into `{}`, and `new RegExp({})` is the valid
  // pattern "[object Object]": a silent wrong answer rather than an error.
  const overTheWire = JSON.parse(JSON.stringify({ matches: /with \d+ rows/i })) as unknown;
  assert.throws(
    () => compileScenario({ reader: "nvda", steps: [{ press: "Tab", expect: overTheWire }] }, "s"),
    /"matches" must be a string .*got \{\}/,
  );
  assert.throws(
    () => validateCheck({ name: "n", matches: {}, equals: 1 }, "here"),
    /"matches" must be a string/,
  );
  // From a JavaScript author who never ran tsc, the object itself.
  assert.throws(
    () => compileScenario({ reader: "nvda", steps: [{ press: "Tab", expect: { matches: /x/i } }] }, "s"),
    /got the RegExp \/x\/i/,
  );
});

test("an expectation applies to each step a repeat expands to", () => {
  const compiled = compileScenario({
    reader: "nvda",
    steps: [{ label: "move", perform: "moveToNextColumn", repeat: 3, expect: { silent: false } }],
  });
  assert.equal(compiled.steps.length, 3);
  for (const step of compiled.steps) {
    assert.deepEqual(step.expect, { silent: false });
  }
});

/* ---------------------------------------------------------------- snapshots */

const RECORDED = ["firefox: 155.0.1", "nvda asset: 0.2.1-2026.2"];

type SnapshotPair = [label: string, heard: string, snapshot?: boolean];

const snapshotOf = (
  pairs: SnapshotPair[],
  { stamp = RECORDED, provenance = "blob: abc" }: { stamp?: string[]; provenance?: string } = {},
): Snapshot =>
  toSnapshot({
    target: "control.html",
    scenario: { name: "s" },
    steps: pairs.map(([label, heard, snapshot]) => ({
      label,
      heard,
      ...(snapshot !== undefined && { snapshot }),
    })),
    stamp,
    provenance,
  });

test("a snapshot holds the announcements and nothing volatile", () => {
  const snapshot = snapshotOf([["a", "said a"]]);
  assert.deepEqual(snapshot.steps, [{ label: "a", heard: "said a" }]);
  // The stamp rides along for context but is not part of what is compared.
  assert.deepEqual(snapshot.recordedWith, RECORDED);
});

test("a step marked snapshot:false is recorded but not snapshotted", () => {
  const snapshot = snapshotOf([
    ["a", "said a"],
    ["volatile", "browser chrome", false],
  ]);
  assert.deepEqual(snapshot.steps.map((s) => s.label), ["a"]);
});

test("no saved snapshot is a baseline, not a failure", () => {
  const comparison = compareSnapshot(snapshotOf([["a", "said a"]]), null);
  assert.equal(comparison.status, "new");
  assert.deepEqual(comparison.differences, []);
});

test("an identical run matches", () => {
  const saved = snapshotOf([["a", "said a"], ["b", "said b"]]);
  const comparison = compareSnapshot(snapshotOf([["a", "said a"], ["b", "said b"]]), saved);
  assert.equal(comparison.status, "match");
});

test("a changed announcement is reported with both wordings", () => {
  const saved = snapshotOf([["a", "combo box, collapsed. Pick a Search Engine"]]);
  const comparison = compareSnapshot(snapshotOf([["a", "Pick a Search Engine"]]), saved);
  assert.equal(comparison.status, "differs");
  assert.deepEqual(comparison.differences, [
    {
      kind: "changed",
      label: "a",
      was: "combo box, collapsed. Pick a Search Engine",
      now: "Pick a Search Engine",
    },
  ]);
});

test("added and removed steps are both reported", () => {
  const saved = snapshotOf([["a", "x"], ["gone", "y"]]);
  const comparison = compareSnapshot(snapshotOf([["a", "x"], ["new", "z"]]), saved);
  assert.deepEqual(
    comparison.differences.map((d) => [d.kind, d.label]).sort(),
    [["added", "new"], ["removed", "gone"]],
  );
});

test("a diff says whether the environment or the target's bytes also changed", () => {
  const saved = snapshotOf([["a", "x"]], { stamp: ["firefox: 155.0.1"], provenance: "blob: old" });
  const fresh = snapshotOf([["a", "y"]], { stamp: ["firefox: 156.0"], provenance: "blob: new" });
  const comparison = compareSnapshot(fresh, saved);
  assert.equal(comparison.environmentChanged, true);
  assert.equal(comparison.provenanceChanged, true);
  assert.deepEqual(comparison.savedEnvironment, ["firefox: 155.0.1"]);
});

test("an unchanged environment is reported as unchanged", () => {
  const saved = snapshotOf([["a", "x"]]);
  const comparison = compareSnapshot(snapshotOf([["a", "y"]]), saved);
  assert.equal(comparison.environmentChanged, false);
  assert.equal(comparison.provenanceChanged, false);
});

test("snapshots round-trip through disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvda-rig-snap-"));
  const path = snapshotPath("control.html", "column-list-table", dir);
  assert.equal(readSnapshot(path), null);
  const snapshot = snapshotOf([["a", "said a"]]);
  writeSnapshot(path, snapshot);
  assert.deepEqual((readSnapshot(path) as Snapshot).steps, snapshot.steps);
});

test("a snapshot re-saved by a Windows editor, BOM and all, still reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvda-rig-snap-"));
  const path = join(dir, "bom.json");
  writeFileSync(path, "﻿" + JSON.stringify(snapshotOf([["a", "said a"]])), "utf8");
  assert.deepEqual((readSnapshot(path) as Snapshot).steps, [{ label: "a", heard: "said a" }]);
});

test("an unreadable snapshot says so rather than being treated as absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvda-rig-snap-"));
  const path = join(dir, "broken.json");
  writeFileSync(path, "{not json", "utf8");
  assert.throws(() => readSnapshot(path), /is not readable JSON/);
});

/* ------------------------------------------------------------------ verdict */

// Complete rather than partial: a half-built OpenResult in a test asserts
// against a shape the rig never actually produces.
const OPENED_OK: OpenResult = {
  ok: true,
  lines: [],
  target: {
    slug: "control.html",
    provenance: "blob: abc",
    url: "file:///fixtures/control.html",
    settle: 14000,
  },
};

const EMPTY_SCENARIO: CompiledScenario = {
  reader: "nvda",
  name: "s",
  description: "",
  steps: [],
  checks: [],
};

test("a clean run passes", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: EMPTY_SCENARIO,
    steps: [{ label: "a", spec: "press:Tab", heard: "said a", expect: { silent: false } } satisfies StepResult],
    comparison: { status: "match", differences: [] },
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasons, []);
});

test("a failed expectation fails the run and names the step", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: EMPTY_SCENARIO,
    steps: [
      { label: "a", spec: "press:Tab", heard: "(silence)", expect: { silent: false } } satisfies StepResult,
    ],
    comparison: { status: "match", differences: [] },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.assertions.map((a) => a.label), ["a"]);
  assert.match(verdict.reasons.join(" "), /1 step expectation\(s\) failed/);
});

/**
 * `results.json` and the stream carry a failed step's spec to the host, and a
 * function cannot cross JSON: it used to vanish from the object entirely. It is
 * named the way the step event has always named it.
 */
test("a failed expectation names its spec in a form the wire can carry", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: EMPTY_SCENARIO,
    steps: [
      { label: "a", spec: "press:Tab", heard: "(silence)", expect: { silent: false } } satisfies StepResult,
      { label: "b", spec: () => undefined, heard: "(silence)", expect: { silent: false } } satisfies StepResult,
    ],
    comparison: { status: "match", differences: [] },
  });
  const onTheWire = JSON.parse(JSON.stringify(verdict.assertions)) as Array<{ spec: string }>;
  assert.deepEqual(onTheWire.map((a) => a.spec), ["press:Tab", "action"]);
});

test("a snapshot difference fails the run", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: EMPTY_SCENARIO,
    steps: [{ label: "a", spec: "press:Tab", heard: "x" } satisfies StepResult],
    comparison: {
      status: "differs",
      differences: [{ kind: "changed", label: "a", was: "x", now: "y" }],
    },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(" "), /snapshot differs in 1 step/);
});

test("a new snapshot does not fail the run", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: EMPTY_SCENARIO,
    steps: [{ label: "a", spec: "press:Tab", heard: "x" } satisfies StepResult],
    comparison: { status: "new", differences: [] },
  });
  assert.equal(verdict.ok, true);
});

test("never reaching the page fails the run, whatever else is true", () => {
  const verdict = judge({
    opened: { ...OPENED_OK, ok: false },
    scenario: EMPTY_SCENARIO,
    steps: [],
    comparison: null,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(" "), /never reached the page/);
});

test("a failed scenario check fails the run", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: {
      ...EMPTY_SCENARIO,
      checks: [{ name: "detail once", matches: "Additional Details", atMost: 1 }],
    },
    steps: steps([["a", "Additional Details"], ["b", "Additional Details"]]),
    comparison: null,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(" "), /1 check\(s\) failed/);
});

test("the verdict is the first thing in the transcript, and says why", () => {
  const scenario = { ...EMPTY_SCENARIO, name: "s" };
  const runSteps: StepResult[] = [
    { label: "a", spec: "press:Tab", heard: "(silence)", expect: { silent: false } },
  ];
  const verdict = judge({ opened: OPENED_OK, scenario, steps: runSteps, comparison: null });
  const transcript = formatTranscript({
    request: { target: "control.html" },
    scenario,
    stamp: RECORDED,
    opened: OPENED_OK,
    steps: runSteps,
    verdict,
    comparison: null,
  });
  const lines = transcript.split("\n");
  assert.equal(lines[0], "# control.html");
  assert.match(transcript, /^## FAIL/m);
  assert.match(transcript, /expected something to be said/);
  // The stamp still has to be there — it is what explains a diff.
  assert.match(transcript, /firefox: 155\.0\.1/);
});

test("a passing transcript says PASS and carries no failure noise", () => {
  const scenario = EMPTY_SCENARIO;
  const runSteps: StepResult[] = [{ label: "a", spec: "press:Tab", heard: "said a" }];
  const verdict = judge({ opened: OPENED_OK, scenario, steps: runSteps, comparison: null });
  const transcript = formatTranscript({
    request: { target: "control.html" },
    scenario,
    stamp: RECORDED,
    opened: OPENED_OK,
    steps: runSteps,
    verdict,
    comparison: null,
  });
  assert.match(transcript, /^## PASS$/m);
  assert.doesNotMatch(transcript, /EXPECTATION FAILED/);
});

test("the shipped scenarios' own expectations and checks are well formed", async () => {
  for (const name of ["column-list-table", "survey"]) {
    const scenario = await loadScenario(name);
    // compileScenario already validated them; assert they are actually present,
    // so a scenario cannot quietly lose its assertions in an edit.
    assert.ok(scenario.checks.length > 0, `${name} has no checks`);
    assert.ok(
      scenario.steps.some((step) => step.expect),
      `${name} has no step expectations`,
    );
  }
});
