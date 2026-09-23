/**
 * Losing focus mid-sequence.
 *
 * The focus guard runs once, before the steps. Nothing re-checked it, so when a
 * Windows Update restart dialog took the foreground part way through a run, the
 * rig sent the remaining 45 steps into it — and because quick-navigation
 * commands are bare letters, `T`, `D` and `H` were typed into the Windows
 * Search box rather than navigating the page. The transcript recorded the
 * desktop as though it were the component under test, and the snapshot diff that
 * followed named 49 changed steps, none of which was the real problem.
 *
 * These tests run off fakes, so they cover the logic without needing a desktop
 * to steal focus on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { runSteps } from "../lib/steps.ts";
import { judge, formatTranscript, toResult } from "../lib/report.ts";
import { SpeechLog } from "../lib/speech.ts";
import type { FocusWatch, ReaderDriver } from "../lib/steps.ts";
import type {
  CompiledScenario,
  CompiledStep,
  NvdaCommand,
  OpenResult,
  StepResult,
} from "../lib/types.ts";

const nvda: ReaderDriver = {
  keyboardCommands: { reportTitle: Symbol("t") } as unknown as Record<NvdaCommand, unknown>,
  perform: () => {},
  press: () => {},
};

/** Speech that answers every step, so a silence never confuses a result. */
const speaking = (): SpeechLog => {
  let n = 0;
  const log: string[] = [];
  return new SpeechLog({
    async spokenPhraseLog() {
      log.push(`said ${++n}`);
      return [...log];
    },
  });
};

const tabs = (count: number): CompiledStep[] =>
  Array.from({ length: count }, (_, i) => ({ label: `tab ${i + 1}`, spec: "press:Tab" as const }));

/** A watch that reports the foreground stolen once `after` steps have run. */
function watchStolenAfter(after: number, every = 5, by = "Select a time to restart"): FocusWatch {
  let seen = 0;
  return {
    every,
    async check() {
      seen += every;
      return seen >= after ? by : null;
    },
  };
}

const NEVER_STOLEN: FocusWatch = { every: 5, check: async () => null };

test("a sequence that keeps focus runs to the end and reports no loss", async () => {
  const result = await runSteps(nvda, speaking(), tabs(12), { watch: NEVER_STOLEN });
  assert.equal(result.steps.length, 12);
  assert.equal(result.focusLost, undefined);
});

test("losing focus stops the sequence instead of typing the rest elsewhere", async () => {
  const result = await runSteps(nvda, speaking(), tabs(40), { watch: watchStolenAfter(10) });
  assert.equal(result.focusLost, "Select a time to restart");
  assert.equal(result.focusLostAfter, 10);
  // The point of the whole change: the remaining 30 steps were never sent.
  assert.equal(result.steps.length, 10);
});

test("at most `every` steps reach the wrong window before the sequence stops", async () => {
  // This is the bound the check interval buys. It is not zero — detection
  // happens after a step, not before — so a scenario sending activating keys
  // wants a smaller interval.
  for (const every of [1, 2, 5]) {
    const result = await runSteps(nvda, speaking(), tabs(60), {
      watch: watchStolenAfter(every, every),
    });
    assert.equal(result.steps.length, every, `interval ${every}`);
  }
});

test("the last step is checked too, so the tail of a transcript is trustworthy", async () => {
  // 12 steps with every: 5 checks at 5 and 10 — and then at 12, which is not a
  // multiple. Without that final check a transcript could end with steps that
  // described the wrong window and say nothing about it.
  const checkedAt: number[] = [];
  let ran = 0;
  const watch: FocusWatch = {
    every: 5,
    async check() {
      checkedAt.push(ran);
      return null;
    },
  };
  const counting = tabs(12).map((step) => ({
    ...step,
    spec: (() => {
      ran += 1;
    }) as CompiledStep["spec"],
  }));
  await runSteps(nvda, speaking(), counting, { watch });
  assert.deepEqual(checkedAt, [5, 10, 12]);
});

test("without a watch the sequence runs blind, which is what it used to do", async () => {
  const result = await runSteps(nvda, speaking(), tabs(8));
  assert.equal(result.steps.length, 8);
  assert.equal(result.focusLost, undefined);
});

/* ------------------------------------------------------------- the verdict */

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

const SCENARIO: CompiledScenario = { reader: "nvda", name: "survey", description: "", steps: [], checks: [] };

const ran: StepResult[] = [{ label: "tab 1", spec: "press:Tab", heard: "said a" }];

test("losing focus fails the run and names what took the foreground", () => {
  const verdict = judge({
    opened: OPENED_OK,
    scenario: SCENARIO,
    steps: ran,
    comparison: null,
    focusLost: "Select a time to restart",
    focusLostAfter: 10,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(" "), /focus left the page after step 10/);
  assert.match(verdict.reasons.join(" "), /Select a time to restart/);
});

test("the transcript explains the truncation where it happened", () => {
  const input = {
    request: { target: "control.html" },
    scenario: SCENARIO,
    stamp: ["firefox: 156.0"],
    opened: OPENED_OK,
    steps: ran,
    comparison: null,
    focusLost: "Select a time to restart",
    focusLostAfter: 1,
    plannedSteps: 49,
  };
  const transcript = formatTranscript({ ...input, verdict: judge(input) });
  assert.match(transcript, /^## FAIL/m);
  assert.match(transcript, /### FOCUS LOST after step 1/);
  assert.match(transcript, /remaining 48 step\(s\) were not run/);
  // A reader has to be told why there is no snapshot section, or its absence
  // reads as the comparison having passed.
  assert.match(transcript, /Snapshot comparison was skipped/);
});

test("a truncated run carries the cause into results.json for CI", () => {
  const input = {
    request: { target: "control.html" },
    scenario: SCENARIO,
    stamp: [],
    opened: OPENED_OK,
    steps: ran,
    comparison: null,
    focusLost: "Select a time to restart",
    focusLostAfter: 1,
  };
  const result = toResult({
    ...input,
    verdict: judge(input),
    transcriptFile: "control.html--survey.txt",
  });
  assert.equal(result.ok, false);
  assert.equal(result.focusLost, "Select a time to restart");
  // Not compared, not "match" — the difference matters to anyone reading this.
  assert.equal(result.snapshot.status, "not compared");
});

test("a clean run records focusLost as null rather than omitting it", () => {
  const input = {
    request: { target: "control.html" },
    scenario: SCENARIO,
    stamp: [],
    opened: OPENED_OK,
    steps: ran,
    comparison: null,
  };
  const result = toResult({
    ...input,
    verdict: judge(input),
    transcriptFile: "t.txt",
  });
  assert.equal(result.focusLost, null);
  assert.equal(result.ok, true);
});
