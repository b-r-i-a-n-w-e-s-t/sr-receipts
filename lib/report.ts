/**
 * Turning a run into something a person reads and something a build can fail on.
 *
 * The transcript stays the primary artefact — it is the evidence, and it is
 * meant to be read. What the verdict at the top of it adds is that the answer
 * is the first thing you see rather than something you reconstruct from sixty
 * announcements, and `results.json` beside it means CI does not have to parse
 * prose.
 */
import { evaluate, runCheck } from "./expect.ts";
import { SILENCE } from "./speech.ts";
import type {
  CompiledScenario,
  OpenResult,
  RunRequest,
  RunResult,
  SnapshotComparison,
  StepResult,
  Verdict,
} from "./types.ts";

export interface JudgeInput {
  opened: OpenResult;
  scenario: CompiledScenario;
  steps: readonly StepResult[];
  comparison: SnapshotComparison | null;
  /** What had the foreground instead, when focus was lost mid-sequence. */
  focusLost?: string | undefined;
  focusLostAfter?: number | undefined;
}

/**
 * Judge a completed run.
 *
 * A run fails if the guards never got it to the page, if focus left the page
 * mid-sequence, if any step's `expect` does not hold, if any scenario `check`
 * does not hold, or if a saved snapshot differs. A missing snapshot is not a
 * failure — it is recorded and reported, so the first run of a new target
 * produces a baseline rather than a red build.
 *
 * Losing focus and never reaching the page are the same kind of answer: the
 * question was not asked, rather than asked and answered wrongly. Both read
 * that way in the verdict.
 */
export function judge({
  opened,
  scenario,
  steps,
  comparison,
  focusLost,
  focusLostAfter,
}: JudgeInput): Verdict {
  const assertions = steps.flatMap((step) => {
    const failures = evaluate(step.heard, step.expect);
    return failures.length === 0 ? [] : [{ label: step.label, spec: step.spec, failures }];
  });

  const checks = scenario.checks.map((check) => runCheck(check, steps));
  const failedChecks = checks.filter((check) => !check.ok);

  const reasons: string[] = [];
  if (!opened.ok) reasons.push("never reached the page in a navigable state");
  if (focusLost) {
    reasons.push(
      `focus left the page after step ${focusLostAfter} (${focusLost} had the foreground)`,
    );
  }
  if (assertions.length) {
    reasons.push(`${assertions.length} step expectation(s) failed`);
  }
  if (failedChecks.length) reasons.push(`${failedChecks.length} check(s) failed`);
  if (comparison?.status === "differs") {
    reasons.push(`snapshot differs in ${comparison.differences.length} step(s)`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    assertions,
    checks,
    snapshot: comparison?.status ?? "not compared",
  };
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

const oneLine = (text: string): string => text.replace(/\n/g, " / ");

/** The verdict block, which goes at the very top of the transcript. */
export function formatVerdict(
  verdict: Verdict,
  comparison: SnapshotComparison | null,
): string[] {
  const lines = [verdict.ok ? "## PASS" : `## FAIL — ${verdict.reasons.join("; ")}`, ""];

  if (verdict.assertions.length) {
    lines.push("### failed expectations");
    for (const { label, spec, failures } of verdict.assertions) {
      lines.push(`  ${label} [${String(spec)}]`);
      for (const failure of failures) lines.push(`    ${failure}`);
    }
    lines.push("");
  }

  const reportedChecks = verdict.checks.filter((check) => !check.ok);
  if (reportedChecks.length) {
    lines.push("### failed checks");
    for (const check of reportedChecks) {
      lines.push(`  ${check.name}: ${check.failures.join("; ")}`);
      lines.push(`    pattern ${check.pattern}`);
      if (check.matchedLabels.length) {
        lines.push(`    matched: ${check.matchedLabels.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (comparison?.status === "new") {
    lines.push("### snapshot", "  none saved; this run is the baseline", "");
  } else if (comparison?.status === "differs") {
    lines.push("### snapshot differences");
    // A diff is not automatically a regression. Say so where it will be read,
    // and give the two reasons it might legitimately differ.
    if (comparison.environmentChanged) {
      lines.push(
        "  NOTE the environment differs from the recorded one; compare the",
        "  stamp below against the saved stamp in the snapshot before",
        "  concluding this is a regression.",
      );
    }
    if (comparison.provenanceChanged) {
      lines.push(
        `  NOTE the target's bytes differ from the recorded ones (was ${comparison.savedProvenance})`,
      );
    }
    for (const difference of comparison.differences) {
      if (difference.kind === "changed") {
        lines.push(`  ~ ${difference.label}`);
        lines.push(`    was ${oneLine(difference.was)}`);
        lines.push(`    now ${oneLine(difference.now)}`);
      } else if (difference.kind === "added") {
        lines.push(`  + ${difference.label}: ${oneLine(difference.now)}`);
      } else {
        lines.push(`  - ${difference.label}: ${oneLine(difference.was)}`);
      }
    }
    lines.push("", "  Accept these with: node runner.ts --update-snapshots", "");
  } else if (comparison?.status === "match") {
    lines.push("### snapshot", "  matches", "");
  }

  return lines;
}

export interface TranscriptInput extends JudgeInput {
  request: Pick<RunRequest, "target">;
  stamp: string[];
  verdict: Verdict;
  /** How many steps the scenario had, so a truncated run can say what it skipped. */
  plannedSteps?: number | undefined;
}

/** The whole transcript: verdict, provenance, guard diagnostics, announcements. */
export function formatTranscript({
  request,
  scenario,
  stamp,
  opened,
  steps,
  verdict,
  comparison,
  focusLost,
  focusLostAfter,
  plannedSteps,
}: TranscriptInput): string {
  const lines = [
    `# ${request.target}`,
    `scenario: ${scenario.name}${scenario.description ? ` — ${scenario.description}` : ""}`,
    "",
    ...formatVerdict(verdict, comparison),
    ...stamp,
    opened.target.provenance,
    // A responsive target says different things at different widths, so a
    // transcript that does not record the width cannot be compared to another.
    ...(scenario.window
      ? [`browser window: ${scenario.window.width}x${scenario.window.height}`]
      : []),
    `run started: ${new Date().toISOString()}`,
    "",
    ...opened.lines,
  ];

  for (const step of steps) {
    lines.push(`### ${step.label} [${String(step.spec)}]`, step.heard, "");
    const failures = evaluate(step.heard, step.expect);
    if (failures.length) {
      lines.push("EXPECTATION FAILED", indent(failures.join("\n")), "");
    }
  }

  if (focusLost) {
    const skipped = (plannedSteps ?? steps.length) - steps.length;
    lines.push(
      `### FOCUS LOST after step ${focusLostAfter}`,
      `  ${focusLost} had the foreground.`,
      skipped > 0
        ? `  The remaining ${skipped} step(s) were not run.`
        : "  The sequence had already finished, so no steps were skipped — but",
      ...(skipped > 0
        ? []
        : ["  the announcements near the end of it may describe the wrong window."]),
      "",
      "  Quick-navigation commands are bare letters, so sending them to another",
      "  window types them in as text rather than navigating. The sequence stops",
      "  instead of doing that.",
      "",
      "  Snapshot comparison was skipped: a truncated run would report every",
      "  remaining step as removed and bury this.",
      "",
    );
  }

  return lines.join("\n");
}

export interface ToResultInput extends TranscriptInput {
  transcriptFile: string;
}

/** What CI reads. One entry per run request. */
export function toResult({
  request,
  scenario,
  opened,
  steps,
  verdict,
  comparison,
  focusLost,
  transcriptFile,
}: ToResultInput): RunResult {
  return {
    target: request.target,
    scenario: scenario.name,
    ok: verdict.ok,
    reasons: verdict.reasons,
    openedOk: opened.ok,
    provenance: opened.target.provenance,
    transcript: transcriptFile,
    steps: steps.length,
    silentSteps: steps.filter((step) => step.heard === SILENCE).length,
    erroredSteps: steps.filter((step) => step.error).length,
    failedExpectations: verdict.assertions,
    checks: verdict.checks,
    snapshot: comparison
      ? { status: comparison.status, differences: comparison.differences.length }
      : { status: "not compared", differences: 0 },
    focusLost: focusLost ?? null,
  };
}
