/**
 * The Execution Target seam, exercised from the host's side of the wire.
 *
 * A fake target stands in for the screen reader, and everything else is real:
 * the host client, the daemon, `executeRun`, scenario loading, the verdict,
 * snapshots, transcripts and `results.json`. What these prove is that the
 * shared run, report and artifact behaviour is driven entirely through the
 * seam, so a second target does not need a platform condition anywhere in it.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createClient, RigError, type RigClient } from "@sr-receipts/host";
import { createRigServer } from "../lib/daemon.ts";
import { executeRun, type RunPaths } from "../lib/run.ts";
import type { ExecutionTarget, ReaderSession } from "../lib/execution-target.ts";
import type { RunStepsResult } from "../lib/steps.ts";
import type { CompiledScenario, OpenResult } from "../lib/types.ts";

const TOKEN = "test-token";
const ENVIRONMENT = ["reader: fake 1.0", "browser: fake 2.0"];

interface FakeOptions {
  validate?: (scenario: CompiledScenario) => void;
  open?: (target: string) => OpenResult;
  perform?: (scenario: CompiledScenario) => RunStepsResult;
}

/** A target that hears "heard <label>" for every step, and records what it was asked. */
function fakeTarget(options: FakeOptions = {}): ExecutionTarget & { calls: string[] } {
  const calls: string[] = [];
  const session: ReaderSession = {
    validate(scenario) {
      calls.push(`validate ${scenario.name}`);
      options.validate?.(scenario);
    },
    async open(target) {
      calls.push(`open ${target}`);
      return (
        options.open?.(target) ?? {
          ok: true,
          lines: ["### fake guard: ready"],
          target: { url: `fake://${target}`, provenance: "fake provenance", settle: 0, slug: target },
        }
      );
    },
    async perform(scenario, onStep) {
      calls.push(`perform ${scenario.name}`);
      const result = options.perform?.(scenario) ?? {
        steps: scenario.steps.map((step) => ({ label: step.label, spec: step.spec, heard: `heard ${step.label}` })),
      };
      result.steps.forEach((step, index) => onStep(step, index));
      return result;
    },
    async stop() {
      calls.push("stop");
    },
  };
  return {
    calls,
    environment: () => ENVIRONMENT,
    async start() {
      calls.push("start");
      return session;
    },
  };
}

/** A scenario file outside the repo, so nothing here depends on the shipped ones. */
function scenarioFile(dir: string, scenario: object): string {
  const path = join(dir, "fake-scenario.json");
  writeFileSync(path, JSON.stringify(scenario), "utf8");
  return path;
}

async function connect(
  t: test.TestContext,
  target: ExecutionTarget,
): Promise<{ client: RigClient; paths: RunPaths; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "sr-receipts-target-"));
  const paths: RunPaths = {
    runs: join(dir, "runs"),
    snapshots: join(dir, "snapshots"),
    lastRun: join(dir, "last-run.txt"),
  };
  let n = 0;
  const server = createRigServer({
    token: TOKEN,
    execute: (options) => executeRun(target, options, paths),
    runDir: (runId) => join(paths.runs, runId),
    newRunId: () => `run-${++n}`,
    stamp: () => target.environment(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { client: createClient({ url: `http://127.0.0.1:${port}`, token: TOKEN }), paths, dir };
}

test("a run on an Execution Target produces the report, stream and artifacts the host reads", async (t) => {
  const target = fakeTarget();
  const { client, paths, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, {
    reader: "nvda",
    name: "fake",
    steps: [{ label: "first", press: "Tab" }, { label: "second", press: "Tab", expect: { includes: "heard" } }],
  });

  const events: string[] = [];
  const report = await client.run([{ target: "page.html", scenario }], {
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(report.ok, true);
  assert.equal(report.results[0]?.snapshot.status, "new");
  assert.deepEqual(events, [
    "run-started", "request-started", "opened", "step", "step", "snapshot", "request-finished", "run-finished",
  ]);
  assert.deepEqual(target.calls, ["start", "validate fake", "open page.html", "perform fake", "stop"]);

  assert.deepEqual((await client.health()).rig, ENVIRONMENT);
  assert.deepEqual(await client.files("run-1"), ["DONE", "events.ndjson", "page.html--fake.txt", "results.json"]);

  const transcript = await client.transcript("run-1", "page.html--fake.txt");
  assert.match(transcript, /^# page\.html\n/);

  // The Receipt carries the evidence itself, so the host need not fetch it.
  const receipt = report.results[0]!;
  assert.deepEqual(receipt.transcript, { file: "page.html--fake.txt", text: transcript });
  assert.deepEqual(receipt.environment, ENVIRONMENT);
  assert.deepEqual(receipt.heard, [
    { label: "first", spec: "press:Tab", heard: "heard first" },
    { label: "second", spec: "press:Tab", heard: "heard second" },
  ]);
  assert.match(transcript, /## PASS/);
  assert.match(transcript, /reader: fake 1\.0\nbrowser: fake 2\.0\nfake provenance/);
  assert.match(transcript, /### first \[press:Tab\]\nheard first/);

  const snapshot = JSON.parse(readFileSync(join(paths.snapshots, "page.html--fake.json"), "utf8"));
  assert.deepEqual(snapshot.recordedWith, ENVIRONMENT);
  assert.equal(readFileSync(paths.lastRun, "utf8"), "run-1\n");
});

test("a scenario the target cannot perform breaks the run before any target opens", async (t) => {
  const target = fakeTarget({
    validate: () => {
      throw new Error("scenario has unrunnable steps");
    },
  });
  const { client, paths, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, { reader: "nvda", name: "fake", steps: ["press:Tab"] });

  await assert.rejects(client.run([{ target: "page.html", scenario }]), (error: RigError) => {
    assert.match(error.message, /run-1 broke: scenario has unrunnable steps/);
    return true;
  });
  assert.deepEqual(target.calls, ["start", "validate fake", "stop"]);
  assert.equal(existsSync(join(paths.runs, "run-1", "results.json")), true);
  assert.match(readFileSync(join(paths.runs, "run-1", "ERROR.txt"), "utf8"), /unrunnable steps/);
});

test("a scenario sent inline crosses the wire and runs as a file would", async (t) => {
  const target = fakeTarget();
  const { client } = await connect(t, target);
  const scenario = {
    reader: "nvda" as const,
    name: "inline",
    steps: [{ label: "first", press: "Tab", expect: { matches: "HEARD \\w+" } }],
  };

  const report = await client.run([
    { target: "a.html", scenario },
    { target: "b.html", scenario },
  ]);

  assert.equal(report.ok, true);
  assert.deepEqual(report.results.map((result) => result.scenario), ["inline", "inline"]);
  // Each request's copy is validated, all of them before the first target opens.
  assert.deepEqual(target.calls, [
    "start", "validate inline", "validate inline", "open a.html", "perform inline", "open b.html", "perform inline", "stop",
  ]);
});

test("a malformed inline scenario breaks the run before the reader starts", async (t) => {
  const target = fakeTarget();
  const { client } = await connect(t, target);

  await assert.rejects(
    client.run([{ target: "a.html", scenario: { reader: "nvda", name: "inline", steps: [] } }]),
    (error: RigError) => {
      assert.match(error.message, /broke: inline: needs a non-empty "steps" array/);
      return true;
    },
  );
  assert.deepEqual(target.calls, []);
});

test("with snapshots off, a run neither reads nor writes the guest's baselines", async (t) => {
  const target = fakeTarget();
  const { client, paths, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, { reader: "nvda", name: "fake", steps: [{ label: "first", press: "Tab" }] });
  const baseline = join(paths.snapshots, "page.html--fake.json");

  // No baseline yet: compare would have written one.
  const events: string[] = [];
  const first = await client.run([{ target: "page.html", scenario }], {
    snapshots: "off",
    onEvent: (event) => events.push(event.type),
  });
  assert.equal(first.ok, true);
  assert.equal(first.snapshots, "off");
  assert.equal(first.results[0]?.snapshot.status, "not compared");
  assert.equal(events.includes("snapshot"), false);
  assert.equal(existsSync(baseline), false);

  // A baseline that differs: compare would have failed on it.
  await client.run([{ target: "page.html", scenario }]);
  const saved = JSON.parse(readFileSync(baseline, "utf8"));
  saved.steps[0].heard = "something else";
  writeFileSync(baseline, JSON.stringify(saved), "utf8");

  const second = await client.run([{ target: "page.html", scenario }], { snapshots: "off" });
  assert.equal(second.ok, true);
  assert.doesNotMatch(second.results[0]!.transcript.text, /update-snapshots|snapshot/);
  assert.equal(JSON.parse(readFileSync(baseline, "utf8")).steps[0].heard, "something else");
});

test("update accepts what the run heard over a differing baseline, and compare then matches it", async (t) => {
  const target = fakeTarget();
  const { client, paths, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, { reader: "nvda", name: "fake", steps: [{ label: "first", press: "Tab" }] });
  const baseline = join(paths.snapshots, "page.html--fake.json");

  await client.run([{ target: "page.html", scenario }]);
  const saved = JSON.parse(readFileSync(baseline, "utf8"));
  saved.steps[0].heard = "something else";
  writeFileSync(baseline, JSON.stringify(saved), "utf8");

  const differs = await client.run([{ target: "page.html", scenario }]);
  assert.equal(differs.ok, false);
  assert.equal(differs.results[0]?.snapshot.status, "differs");

  const updated = await client.run([{ target: "page.html", scenario }], { snapshots: "update" });
  assert.equal(updated.ok, true);
  assert.equal(JSON.parse(readFileSync(baseline, "utf8")).steps[0].heard, "heard first");
  assert.equal((await client.run([{ target: "page.html", scenario }])).results[0]?.snapshot.status, "match");
});

test("a target that loses the page fails the run and records no baseline", async (t) => {
  const target = fakeTarget({
    perform: (scenario) => ({
      steps: [{ label: scenario.steps[0]?.label ?? "", spec: "press:Tab", heard: "typed into the wrong window" }],
      focusLost: "Select a time to restart",
      focusLostAfter: 1,
    }),
  });
  const { client, paths, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, { reader: "nvda", name: "fake", steps: ["press:Tab", "press:Tab"] });

  const report = await client.run([{ target: "page.html", scenario }]);

  assert.equal(report.ok, false);
  assert.equal(report.results[0]?.focusLost, "Select a time to restart");
  assert.equal(report.results[0]?.snapshot.status, "not compared");
  assert.equal(existsSync(join(paths.snapshots, "page.html--fake.json")), false);
});

test("a target that never reaches the page still leaves its diagnosis as the transcript", async (t) => {
  const target = fakeTarget({
    open: (entry) => ({
      ok: false,
      lines: ["### FOCUS FAILED", "title reported: Desktop"],
      target: { url: `fake://${entry}`, provenance: "fake provenance", settle: 0, slug: entry },
    }),
  });
  const { client, dir } = await connect(t, target);
  const scenario = scenarioFile(dir, { reader: "nvda", name: "fake", steps: ["press:Tab"] });

  const report = await client.run([{ target: "page.html", scenario }]);

  assert.equal(report.ok, false);
  assert.equal(report.results[0]?.openedOk, false);
  assert.deepEqual(target.calls, ["start", "validate fake", "open page.html", "stop"]);
  assert.match(await client.transcript(report.runId, "page.html--fake.txt"), /### FOCUS FAILED\ntitle reported: Desktop/);
});
