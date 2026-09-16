/**
 * The daemon, without the rig.
 *
 * `createRigServer` takes its executor, so everything here except NVDA itself
 * runs on any machine — which matters, because the host these tests are most
 * likely to be edited on is the Mac, and the guest is the one place a real run
 * can happen. What is worth testing without a desktop is the part that faces
 * the network: who gets in, what happens to a second caller, and whether a run
 * id from a URL can name a file outside its own directory.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import {
  createRigServer,
  isSafeSegment,
  resolveRunFile,
  resolveToken,
  toRequests,
} from "../lib/daemon.ts";
import type { ExecuteOptions } from "../lib/run.ts";
import type { RunEvent, RunReport } from "../lib/types.ts";

const TOKEN = "test-token";

const report = (runId: string): RunReport => ({
  runId,
  finishedAt: "2026-09-15T00:00:00.000Z",
  ok: true,
  broke: null,
  updatedSnapshots: false,
  total: 1,
  failed: 0,
  results: [],
});

interface Harness {
  url: string;
  server: Server;
  root: string;
  /** Resolves the executor currently in flight, for the busy tests. */
  finish: (() => void) | null;
}

/**
 * A server on an ephemeral port with a scriptable executor.
 *
 * `execute` emits a couple of events and then waits to be released, so a test
 * can hold a run open and ask what the daemon does to a second caller.
 */
async function harness(t: test.TestContext, options: { block?: boolean } = {}): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "nvda-rig-test-"));
  let counter = 0;

  const state: Harness = {
    url: "",
    root,
    finish: null,
    server: createRigServer({
      token: TOKEN,
      runDir: (runId) => join(root, runId),
      newRunId: () => `run-${++counter}`,
      stamp: () => ["Windows: test", "NVDA: test"],
      async execute({ requests, runId, onEvent }: ExecuteOptions) {
        const id = runId as string;
        onEvent?.({ type: "run-started", runId: id, total: requests.length });
        onEvent?.({
          type: "step",
          target: requests[0]?.target ?? "?",
          index: 0,
          label: "title bar",
          spec: "perform:reportTitle",
          heard: "control, Mozilla Firefox",
        });
        if (options.block) {
          await new Promise<void>((resolve) => {
            state.finish = resolve;
          });
        }
        const finished = report(id);
        onEvent?.({ type: "run-finished", report: finished });
        return finished;
      },
    }),
  };

  // `listen` is asynchronous: the port is not assigned, and `address()` returns
  // null, until the listening event fires.
  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => state.server.close(() => resolve())));
  const { port } = state.server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}`;
  return state;
}

const auth = { authorization: `Bearer ${TOKEN}` };

const post = (url: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${url}/runs`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function frames(response: Response): Promise<RunEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}

/* --------------------------------------------------------------------- auth */

test("a request with no token is refused", async (t) => {
  const { url } = await harness(t);
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 401);
});

test("a wrong token is refused, and told apart from a missing one", async (t) => {
  const { url } = await harness(t);
  const response = await fetch(`${url}/health`, { headers: { authorization: "Bearer nope" } });
  assert.equal(response.status, 403);
});

/**
 * The comparison is constant-time, which throws on a length mismatch unless the
 * lengths are checked first. A wrong-length token must be a 403 like any other,
 * not a 500 — a 500 here would be a length oracle.
 */
test("a token of the wrong length is refused rather than crashing", async (t) => {
  const { url } = await harness(t);
  const response = await fetch(`${url}/health`, { headers: { authorization: "Bearer x" } });
  assert.equal(response.status, 403);
});

test("health reports the stamp and whether a run is in flight", async (t) => {
  const { url } = await harness(t);
  const health = (await (await fetch(`${url}/health`, { headers: auth })).json()) as {
    ok: boolean;
    busy: boolean;
    runId: string | null;
    rig: string[];
  };
  assert.equal(health.ok, true);
  assert.equal(health.busy, false);
  assert.equal(health.runId, null);
  assert.deepEqual(health.rig, ["Windows: test", "NVDA: test"]);
});

/* ---------------------------------------------------------------- streaming */

test("POST /runs streams NDJSON and ends with the report", async (t) => {
  const { url } = await harness(t);
  const response = await post(url, { requests: [{ target: "control.html", scenario: "survey" }] });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
  assert.equal(response.headers.get("x-run-id"), "run-1");

  const events = await frames(response);
  assert.deepEqual(
    events.map((event) => event.type),
    ["run-started", "step", "run-finished"],
  );
  const last = events.at(-1) as Extract<RunEvent, { type: "run-finished" }>;
  assert.equal(last.report.runId, "run-1");
});

/**
 * The file is what a client that hung up reads back, so it has to be written
 * from inside the run rather than assembled from the response.
 */
test("a run's events are recorded on disk as they happen", async (t) => {
  const { url, root } = await harness(t);
  await post(url, { requests: [{ target: "control.html", scenario: "survey" }] }).then((r) =>
    r.text(),
  );

  const replay = await fetch(`${url}/runs/run-1/events`, { headers: auth });
  assert.equal(replay.status, 200);
  const events = await frames(replay);
  assert.deepEqual(
    events.map((event) => event.type),
    ["run-started", "step", "run-finished"],
  );
  assert.ok(root);
});

/* -------------------------------------------------------------- concurrency */

test("a second run while one is in flight is refused, and names the run holding the desktop", async (t) => {
  const state = await harness(t, { block: true });

  const first = post(state.url, { requests: [{ target: "a.html", scenario: "survey" }] });
  // Wait until the daemon has actually taken the run, not merely been asked.
  await first;
  while (!state.finish) await new Promise((resolve) => setTimeout(resolve, 5));

  const second = await post(state.url, { requests: [{ target: "b.html", scenario: "survey" }] });
  assert.equal(second.status, 409);
  const body = (await second.json()) as { error: string; runId: string };
  assert.match(body.error, /already in flight/);
  assert.equal(body.runId, "run-1");

  const health = (await (await fetch(`${state.url}/health`, { headers: auth })).json()) as {
    busy: boolean;
    runId: string;
  };
  assert.equal(health.busy, true);
  assert.equal(health.runId, "run-1");

  state.finish?.();
  await (await first).text();
});

/* ------------------------------------------------------------------ bodies */

test("toRequests accepts a queue file's text, using the same parser the runner does", () => {
  assert.deepEqual(toRequests({ queue: "# a comment\ncontrol.html :: survey\n\nb.html :: table" }), [
    { target: "control.html", scenario: "survey" },
    { target: "b.html", scenario: "table" },
  ]);
});

test("toRequests applies a scenario override to every request, as --scenario does", () => {
  assert.deepEqual(
    toRequests({
      requests: [
        { target: "a.html", scenario: "survey" },
        { target: "b.html" },
      ],
      scenario: "table",
    }),
    [
      { target: "a.html", scenario: "table" },
      { target: "b.html", scenario: "table" },
    ],
  );
});

test("toRequests rejects a request with no scenario and no override", () => {
  assert.throws(() => toRequests({ requests: [{ target: "a.html" }] }), /names no scenario/);
});

test("toRequests rejects the ways a body can be empty or contradictory", () => {
  assert.throws(() => toRequests({}), /`requests`/);
  assert.throws(() => toRequests({ requests: [] }), /no requests/);
  assert.throws(() => toRequests({ requests: [], queue: "x" }), /not both/);
  assert.throws(
    () => toRequests({ requests: [{ target: "  " }], scenario: "survey" }),
    /names no target/,
  );
});

test("a body that will not parse is a 400 naming what was wrong, not a stream", async (t) => {
  const { url } = await harness(t);
  const response = await post(url, { requests: [{ scenario: "survey" }] });
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /names no target/);
});

/* -------------------------------------------------------------- run readout */

test("a finished run's report and transcripts can be read back", async (t) => {
  const { url, root } = await harness(t);
  mkdirSync(join(root, "run-9"), { recursive: true });
  writeFileSync(join(root, "run-9", "results.json"), JSON.stringify(report("run-9")), "utf8");
  writeFileSync(join(root, "run-9", "control.html--survey.txt"), "# control.html\n", "utf8");

  const fetched = (await (await fetch(`${url}/runs/run-9`, { headers: auth })).json()) as RunReport;
  assert.equal(fetched.runId, "run-9");

  const listed = (await (await fetch(`${url}/runs/run-9/files`, { headers: auth })).json()) as {
    files: string[];
  };
  assert.deepEqual(listed.files, ["control.html--survey.txt", "results.json"]);

  const transcript = await (
    await fetch(`${url}/runs/run-9/files/control.html--survey.txt`, { headers: auth })
  ).text();
  assert.equal(transcript, "# control.html\n");
});

/**
 * A run that exists but has not written `results.json` is not a 404 — the run
 * id is real and the answer is "not yet", which is a different thing for a
 * client deciding whether to retry.
 */
test("an unfinished run reports that it is unfinished, not that it is missing", async (t) => {
  const { url, root } = await harness(t);
  mkdirSync(join(root, "run-8"), { recursive: true });
  const response = await fetch(`${url}/runs/run-8`, { headers: auth });
  assert.equal(response.status, 202);
  assert.equal(((await response.json()) as { done: boolean }).done, false);
});

/* ------------------------------------------------------------------ escapes */

/**
 * Both path segments reach a `join` against the runs directory, and `%2f`
 * survives the route pattern's `[^/]+` because it only becomes a separator
 * after decoding. These are the requests that would otherwise read the guest's
 * disk through a port whose whole job is to hand back text files.
 *
 * Asserted as "refused", not as a particular status, because two different
 * things refuse them. `URL` normalizes `%2e%2e` to `..` and collapses the
 * segment away before routing, so that one never reaches the guard and falls
 * out as a 404; the ones carrying an encoded separator do reach it and are
 * 400s. What must hold either way is that none of them returns a file.
 */
test("a run id or file name cannot escape the runs directory", async (t) => {
  const { url } = await harness(t);
  for (const path of [
    "/runs/..%2f..%2fqueue.txt",
    "/runs/%2e%2e",
    "/runs/%2e%2e%2f%2e%2e%2fqueue.txt",
    "/runs/run-1/files/..%2f..%2fqueue.txt",
    "/runs/run-1/files/%2e%2e%2fresults.json",
  ]) {
    const response = await fetch(`${url}${path}`, { headers: auth });
    assert.ok(
      response.status === 400 || response.status === 404,
      `${path} should be refused, got ${response.status}`,
    );
  }
});

test("isSafeSegment accepts a run id and rejects a traversal", () => {
  assert.ok(isSafeSegment("2026-09-15T140301"));
  assert.ok(isSafeSegment("run-1"));
  for (const bad of ["..", ".", "a/b", "a\\b", "", "a b", "a:b"]) {
    assert.equal(isSafeSegment(bad), false, `${JSON.stringify(bad)} should be refused`);
  }
});

test("resolveRunFile returns null rather than a path outside the run", () => {
  const root = mkdtempSync(join(tmpdir(), "nvda-rig-test-"));
  writeFileSync(join(root, "ok.txt"), "x", "utf8");
  assert.equal(resolveRunFile(root, "ok.txt"), join(root, "ok.txt"));
  assert.equal(resolveRunFile(root, ".."), null);
  assert.equal(resolveRunFile(root, "missing.txt"), null);
  // basename() reduces this to "queue.txt", which does not exist in the run.
  assert.equal(resolveRunFile(root, "..%2Fqueue.txt"), null);
});

test("an unknown route is a 404 that says what was asked for", async (t) => {
  const { url } = await harness(t);
  const response = await fetch(`${url}/nope`, { headers: auth });
  assert.equal(response.status, 404);
  assert.match(((await response.json()) as { error: string }).error, /GET \/nope/);
});

/**
 * The busy check and the claim are separated by the await that reads the body.
 * If the claim happened after it, two requests arriving together would both
 * have passed the check before either claimed, and two runs would land on one
 * desktop — which is the failure the 409 exists to prevent, arriving by the
 * one route the 409 does not cover.
 */
test("two runs posted at the same instant cannot both be accepted", async (t) => {
  const state = await harness(t, { block: true });

  const both = await Promise.all([
    post(state.url, { requests: [{ target: "a.html", scenario: "survey" }] }),
    post(state.url, { requests: [{ target: "b.html", scenario: "survey" }] }),
  ]);

  const accepted = both.filter((response) => response.status === 200);
  const refused = both.filter((response) => response.status === 409);
  assert.equal(accepted.length, 1, "exactly one run should be accepted");
  assert.equal(refused.length, 1, "the other should be refused");

  while (!state.finish) await new Promise((resolve) => setTimeout(resolve, 5));
  state.finish();
  await Promise.all(both.map((response) => response.text()));
});

/* ------------------------------------------------------------------- token */

test("a token that was set is used as it stands", () => {
  assert.deepEqual(resolveToken({ token: "given", interactive: true }), {
    token: "given",
    generated: false,
  });
  assert.deepEqual(resolveToken({ token: "given", interactive: false }), {
    token: "given",
    generated: false,
  });
});

/**
 * Started by hand, the daemon makes a token rather than demanding one. The
 * friction of inventing a secret before `npm run daemon` will run is the kind
 * that ends with the auth being deleted instead.
 */
test("started by hand with no token, one is generated and flagged for printing", () => {
  const first = resolveToken({ interactive: true });
  const second = resolveToken({ interactive: true });
  assert.equal(first.generated, true);
  assert.ok(first.token.length >= 32);
  assert.notEqual(first.token, second.token, "each start should get its own token");
});

/**
 * The scheduled task has no terminal, so a generated token would exist only in
 * a log file and the host could never present it. Refusing is the correct
 * failure.
 */
test("started with no terminal and no token, it refuses rather than generating", () => {
  assert.throws(() => resolveToken({ interactive: false }), /RIG_TOKEN is not set/);
  assert.throws(() => resolveToken({ token: "", interactive: false }), /will not start/);
});

test("a daemon cannot be created without a token", () => {
  assert.throws(
    () =>
      createRigServer({
        token: "",
        execute: async () => report("x"),
        runDir: (id) => id,
        newRunId: () => "x",
        stamp: () => [],
      }),
    /RIG_TOKEN/,
  );
});
