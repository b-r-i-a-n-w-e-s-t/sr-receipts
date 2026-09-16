/**
 * The host's side of the wire, against the guest's side of it.
 *
 * These run both halves in one process over a real socket, with a fake executor
 * standing in for NVDA. That is the most that can be tested off the guest, and
 * it is the half most likely to be wrong: the frame splitting, and what a
 * caller is told when a run breaks rather than merely fails.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createRigServer } from "../lib/daemon.ts";
import { createClient, readFrames, RigError, type RigClient } from "../lib/client.ts";
import type { ExecuteOptions } from "../lib/run.ts";
import type { RunEvent, RunReport } from "../lib/types.ts";

const TOKEN = "test-token";

const report = (runId: string, overrides: Partial<RunReport> = {}): RunReport => ({
  runId,
  finishedAt: "2026-09-15T00:00:00.000Z",
  ok: true,
  broke: null,
  updatedSnapshots: false,
  total: 1,
  failed: 0,
  results: [],
  ...overrides,
});

/** A client wired to a server whose executor does whatever the test says. */
async function connect(
  t: test.TestContext,
  execute: (options: ExecuteOptions) => Promise<RunReport>,
  { token = TOKEN } = {},
): Promise<RigClient> {
  const root = mkdtempSync(join(tmpdir(), "nvda-rig-client-"));
  const server = createRigServer({
    token: TOKEN,
    execute,
    runDir: (runId) => join(root, runId),
    newRunId: () => "run-1",
    stamp: () => ["Windows: test"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return createClient({ url: `http://127.0.0.1:${port}`, token });
}

/** What a passing run looks like on the wire. */
const happy = async ({ requests, runId, onEvent }: ExecuteOptions): Promise<RunReport> => {
  const id = runId as string;
  onEvent?.({ type: "run-started", runId: id, total: requests.length });
  for (const [index, request] of requests.entries()) {
    onEvent?.({
      type: "step",
      target: request.target,
      index,
      label: "title bar",
      spec: "perform:reportTitle",
      heard: "control, Mozilla Firefox\nHistorical Structures, table",
    });
  }
  const finished = report(id);
  onEvent?.({ type: "run-finished", report: finished });
  return finished;
};

test("run resolves with the report and forwards every event on the way", async (t) => {
  const rig = await connect(t, happy);
  const seen: RunEvent[] = [];

  const result = await rig.run([{ target: "control.html", scenario: "survey" }], {
    onEvent: (event) => seen.push(event),
  });

  assert.equal(result.runId, "run-1");
  assert.equal(result.ok, true);
  assert.deepEqual(
    seen.map((event) => event.type),
    ["run-started", "step", "run-finished"],
  );
});

/**
 * The reason the step event carries a `StepResult` rather than `log`'s
 * pre-formatted line: a multi-phrase announcement has newlines in it, and
 * NDJSON frames are newline-delimited. If the announcement were not escaped by
 * `JSON.stringify` this is the test that would fail, and it would fail as a
 * truncated transcript rather than as an error.
 */
test("an announcement containing newlines survives the framing intact", async (t) => {
  const rig = await connect(t, happy);
  const steps: string[] = [];
  await rig.run([{ target: "control.html", scenario: "survey" }], {
    onEvent: (event) => {
      if (event.type === "step") steps.push(event.heard);
    },
  });
  assert.deepEqual(steps, ["control, Mozilla Firefox\nHistorical Structures, table"]);
});

test("a failing run resolves — a wrong answer is a result, not an error", async (t) => {
  const rig = await connect(t, async ({ runId, onEvent }) => {
    const finished = report(runId as string, { ok: false, total: 1, failed: 1 });
    onEvent?.({ type: "run-finished", report: finished });
    return finished;
  });

  const result = await rig.run([{ target: "control.html", scenario: "survey" }]);
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
});

/**
 * The opposite case, and the distinction the exit codes have always drawn:
 * `broke` is an unanswered question, so it reaches the caller as an exception
 * rather than as a report they might read the `ok` field off.
 */
test("a broken run rejects, naming the run so its directory can be read", async (t) => {
  const rig = await connect(t, async ({ runId, onEvent }) => {
    const finished = report(runId as string, { ok: false, broke: "NVDA would not start" });
    onEvent?.({ type: "run-finished", report: finished });
    return finished;
  });

  await assert.rejects(
    rig.run([{ target: "control.html", scenario: "survey" }]),
    (error: RigError) => {
      assert.ok(error instanceof RigError);
      assert.match(error.message, /run-1 broke: NVDA would not start/);
      return true;
    },
  );
});

/** A stream that stops without a verdict is the daemon or the guest dying. */
test("a stream that ends with no verdict rejects rather than resolving empty", async (t) => {
  const rig = await connect(t, async ({ runId, onEvent }) => {
    onEvent?.({ type: "run-started", runId: runId as string, total: 1 });
    return report(runId as string);
  });

  await assert.rejects(rig.run([{ target: "control.html", scenario: "survey" }]), /without a verdict/);
});

test("a rejected request arrives as a RigError carrying the status", async (t) => {
  const rig = await connect(t, happy, { token: "wrong-token" });
  await assert.rejects(rig.health(), (error: RigError) => {
    assert.equal(error.status, 403);
    return true;
  });
});

test("health and the readback routes round-trip", async (t) => {
  const rig = await connect(t, happy);

  const health = await rig.health();
  assert.equal(health.busy, false);
  assert.deepEqual(health.rig, ["Windows: test"]);

  await rig.run([{ target: "control.html", scenario: "survey" }]);

  const fetched = await rig.report("run-1");
  assert.equal(fetched.runId, "run-1");
  // The executor is a fake, so the only file the run left is its event log.
  assert.deepEqual(await rig.files("run-1"), ["events.ndjson"]);
});

/* --------------------------------------------------------------- framing */

/** Frames arrive split across chunks and several to a chunk; both must work. */
function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const collect = async (chunks: string[]): Promise<RunEvent[]> => {
  const events: RunEvent[] = [];
  for await (const event of readFrames(stream(chunks))) events.push(event);
  return events;
};

test("readFrames reassembles a frame split across chunks", async () => {
  const events = await collect(['{"type":"run-star', 'ted","runId":"r","total":2}\n']);
  assert.deepEqual(events, [{ type: "run-started", runId: "r", total: 2 }]);
});

test("readFrames splits several frames arriving in one chunk", async () => {
  const events = await collect([
    '{"type":"run-started","runId":"r","total":1}\n{"type":"broke","message":"x"}\n',
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["run-started", "broke"],
  );
});

test("readFrames yields a last frame that arrived without a trailing newline", async () => {
  const events = await collect(['{"type":"broke","message":"x"}']);
  assert.deepEqual(events, [{ type: "broke", message: "x" }]);
});

/**
 * A multi-byte character can be split across a chunk boundary. The decoder is
 * called in streaming mode so the halves are rejoined rather than each becoming
 * a replacement character — NVDA's announcements contain them, notably the
 * object-replacement character focus mode appends.
 */
test("readFrames rejoins a multi-byte character split across chunks", async () => {
  const frame = JSON.stringify({ type: "broke", message: "focus mode ￼" }) + "\n";
  const bytes = new TextEncoder().encode(frame);
  const split = 15;
  const events: RunEvent[] = [];
  const parts = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
  for await (const event of readFrames(parts)) events.push(event);
  assert.deepEqual(events, [{ type: "broke", message: "focus mode ￼" }]);
});
