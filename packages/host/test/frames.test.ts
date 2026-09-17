/**
 * NDJSON framing, on its own. The client-against-daemon behaviour is tested in
 * `@sr-receipts/guest`, which can depend on this package and run both halves.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { readFrames, type RunEvent } from "../src/index.ts";

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
