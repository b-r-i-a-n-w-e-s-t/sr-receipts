/**
 * Committed transcripts, and diffing a run against them.
 *
 * A scenario's `expect` says what must be true whatever the target. A snapshot
 * is the other half: the exact wording one target produced, recorded so that any
 * later change in what a screen reader says shows up as a diff rather than as
 * nobody noticing.
 *
 * ## What is and is not in a snapshot
 *
 * Only `label -> heard`, for steps not marked `snapshot: false`. Deliberately
 * excluded:
 *
 * - The environment stamp. It changes whenever Firefox or NVDA updates, and a
 *   snapshot that fails on every browser update is a snapshot nobody reads. It
 *   is still written into the transcript, because it is what *explains* a diff.
 * - Timestamps and the run id, which differ on every run by construction.
 * - The focus-guard block, which is diagnostics about reaching the page rather
 *   than an answer about the page.
 *
 * ## When a snapshot changes
 *
 * A diff is not automatically a regression — a Firefox upgrade really did change
 * a toolbar announcement between 155.0.1 and 156.0 during this rig's own
 * development. That is exactly why the transcript's stamp and the snapshot's
 * recorded stamp both exist: compare them, decide, and accept with
 * `--update-snapshots` if the new wording is correct.
 */
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { slugify } = require("./target.cjs");

const SNAPSHOTS = join(__dirname, "..", "snapshots");

/** One file per (target, scenario), named the way transcripts are. */
function snapshotPath(targetSlug, scenarioName, dir = SNAPSHOTS) {
  return join(dir, `${targetSlug}--${slugify(scenarioName)}.json`);
}

/**
 * The comparable part of a run.
 *
 * `provenance` rides along so a diff can say "and the fixture's bytes changed
 * too", which is the difference between "the component regressed" and "you
 * edited the fixture".
 */
function toSnapshot({ target, scenario, steps, stamp, provenance }) {
  return {
    target,
    scenario: scenario.name,
    provenance,
    // Recorded for context when a diff needs explaining. Not compared.
    recordedWith: stamp,
    recordedAt: new Date().toISOString(),
    steps: steps
      .filter((step) => step.snapshot !== false)
      .map((step) => ({ label: step.label, heard: step.heard })),
  };
}

function readSnapshot(path) {
  if (!existsSync(path)) return null;
  try {
    // Strip a UTF-8 BOM. The rig never writes one, but a snapshot reviewed and
    // re-saved in a Windows editor arrives with one — Windows PowerShell's
    // `Set-Content -Encoding utf8` adds it — and JSON.parse rejects it with an
    // error that says nothing useful about why.
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`snapshot at ${path} is not readable JSON: ${error.message}`);
  }
}

function writeSnapshot(path, snapshot) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

/**
 * Compare a fresh snapshot against a saved one.
 *
 * Steps are matched by label, in order. A label that moved is reported as both a
 * removal and an addition rather than as a rename, because a scenario edit that
 * reorders steps genuinely does invalidate the comparison and should look like
 * it.
 */
function compareSnapshot(fresh, saved) {
  if (!saved) return { status: "new", differences: [] };

  const savedByLabel = new Map(saved.steps.map((step) => [step.label, step.heard]));
  const freshByLabel = new Map(fresh.steps.map((step) => [step.label, step.heard]));
  const differences = [];

  for (const step of fresh.steps) {
    if (!savedByLabel.has(step.label)) {
      differences.push({ kind: "added", label: step.label, now: step.heard });
    } else if (savedByLabel.get(step.label) !== step.heard) {
      differences.push({
        kind: "changed",
        label: step.label,
        was: savedByLabel.get(step.label),
        now: step.heard,
      });
    }
  }
  for (const step of saved.steps) {
    if (!freshByLabel.has(step.label)) {
      differences.push({ kind: "removed", label: step.label, was: step.heard });
    }
  }

  const environmentChanged =
    JSON.stringify(saved.recordedWith) !== JSON.stringify(fresh.recordedWith);
  const provenanceChanged = saved.provenance !== fresh.provenance;

  return {
    status: differences.length === 0 ? "match" : "differs",
    differences,
    // Both are reasons a diff may be legitimate rather than a regression.
    environmentChanged,
    provenanceChanged,
    savedEnvironment: saved.recordedWith,
    savedProvenance: saved.provenance,
  };
}

module.exports = {
  SNAPSHOTS,
  snapshotPath,
  toSnapshot,
  readSnapshot,
  writeSnapshot,
  compareSnapshot,
};
