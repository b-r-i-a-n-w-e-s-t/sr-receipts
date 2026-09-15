/**
 * Turning a run into something a person reads and something a build can fail on.
 *
 * The transcript stays the primary artefact — it is the evidence, and it is
 * meant to be read. What Phase 3 adds is a verdict at the top of it, so the
 * answer is the first thing you see rather than something you reconstruct from
 * sixty announcements, and a `results.json` beside it so CI does not have to
 * parse prose.
 */
const { evaluate, runCheck } = require("./expect.cjs");

/**
 * Judge a completed run.
 *
 * A run fails if the guards never got it to the page, if any step's `expect`
 * does not hold, if any scenario `check` does not hold, or if a saved snapshot
 * differs. A missing snapshot is not a failure — it is recorded and reported, so
 * the first run of a new target produces a baseline rather than a red build.
 */
function judge({ opened, scenario, steps, comparison }) {
  const assertions = steps.flatMap((step) => {
    const failures = evaluate(step.heard, step.expect);
    return failures.length === 0
      ? []
      : [{ label: step.label, spec: step.spec, failures }];
  });

  const checks = scenario.checks.map((check) => runCheck(check, steps));
  const failedChecks = checks.filter((check) => !check.ok);

  const reasons = [];
  if (!opened.ok) reasons.push("never reached the page in a navigable state");
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

const indent = (text) =>
  String(text)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/** The verdict block, which goes at the very top of the transcript. */
function formatVerdict(verdict, comparison) {
  const lines = [
    verdict.ok ? "## PASS" : `## FAIL — ${verdict.reasons.join("; ")}`,
    "",
  ];

  if (verdict.assertions.length) {
    lines.push("### failed expectations");
    for (const { label, spec, failures } of verdict.assertions) {
      lines.push(`  ${label} [${spec}]`);
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
        lines.push(`    was ${difference.was.replace(/\n/g, " / ")}`);
        lines.push(`    now ${difference.now.replace(/\n/g, " / ")}`);
      } else if (difference.kind === "added") {
        lines.push(`  + ${difference.label}: ${difference.now.replace(/\n/g, " / ")}`);
      } else {
        lines.push(`  - ${difference.label}: ${difference.was.replace(/\n/g, " / ")}`);
      }
    }
    lines.push("", "  Accept these with: node runner.cjs --update-snapshots", "");
  } else if (comparison?.status === "match") {
    lines.push("### snapshot", "  matches", "");
  }

  return lines;
}

/** The whole transcript: verdict, provenance, guard diagnostics, announcements. */
function formatTranscript({ request, scenario, stamp, opened, steps, verdict, comparison }) {
  const lines = [
    `# ${request.target}`,
    `scenario: ${scenario.name}${scenario.description ? ` — ${scenario.description}` : ""}`,
    "",
    ...formatVerdict(verdict, comparison),
    ...stamp,
    opened.target.provenance,
    `run started: ${new Date().toISOString()}`,
    "",
    ...opened.lines,
  ];

  for (const step of steps) {
    const shown = `${step.label} [${step.spec}]`;
    lines.push(`### ${shown}`, step.heard, "");
    const failures = evaluate(step.heard, step.expect);
    if (failures.length) {
      lines.push("EXPECTATION FAILED", indent(failures.join("\n")), "");
    }
  }

  return lines.join("\n");
}

/** What CI reads. One entry per run request. */
function toResult({ request, scenario, opened, steps, verdict, comparison, transcriptFile }) {
  return {
    target: request.target,
    scenario: scenario.name,
    ok: verdict.ok,
    reasons: verdict.reasons,
    openedOk: opened.ok,
    provenance: opened.target.provenance,
    transcript: transcriptFile,
    steps: steps.length,
    silentSteps: steps.filter((step) => step.heard === "(silence)").length,
    erroredSteps: steps.filter((step) => step.error).length,
    failedExpectations: verdict.assertions,
    checks: verdict.checks,
    snapshot: comparison
      ? { status: comparison.status, differences: comparison.differences.length }
      : { status: "not compared", differences: 0 },
  };
}

module.exports = { judge, formatVerdict, formatTranscript, toResult };
