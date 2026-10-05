/**
 * The Reader Session against a fake adapter.
 *
 * What every reader gets from `createReaderSession`, proved once: the
 * transcript names silence and records failures, calls are serialized, every
 * call rejects rather than throws, a reader call from inside a capture is
 * refused rather than deadlocking, `start` restarts, and `stop` neither
 * throws nor waits behind a hung call. NVDA's adapter over the real daemon is
 * tested in `@sr-receipts/daemon`, which can depend on this package.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SILENCE, createReaderSession, errorChain, type ReaderAdapter } from "../src/session.ts";
import type { EntryPage } from "../src/protocol.ts";

interface Fake extends ReaderAdapter {
  calls: string[];
}

function fakeAdapter(overrides: Partial<ReaderAdapter> = {}): Fake {
  const calls: string[] = [];
  return {
    calls,
    reader: "nvda",
    async start(record) {
      calls.push("start");
      record("launched on the first attempt");
    },
    async stop() {
      calls.push("stop");
    },
    async enter(_page, _options, record) {
      calls.push("enter");
      record("### focus guard: in the document");
      return "link, Skip to main content";
    },
    perform(command) {
      // Synchronous on purpose: adapters do this, and the session must not.
      if (command === "nope") throw new Error(`unknown NVDA keyboard command: ${command}`);
      calls.push(`perform ${command}`);
      return Promise.resolve(command === "moveToNextTable" ? "" : "said");
    },
    async press(key) {
      calls.push(`press ${key}`);
      return "pressed";
    },
    async type(text, { delay }) {
      calls.push(`type ${text} ${delay ?? "no delay"}`);
      return "b. a. n";
    },
    async next() {
      calls.push("next");
      return "row 2";
    },
    async previous() {
      calls.push("previous");
      return "row 1";
    },
    async capture(action) {
      calls.push("capture begin");
      const result = await action();
      calls.push("capture end");
      return { result, spoken: "1 row selected" };
    },
    spokenPhraseLog: async () => ["a"],
    clearSpokenPhraseLog: async () => undefined,
    environment: async () => ["windows: test"],
    ...overrides,
  };
}

const page: EntryPage = {
  title: async () => "Component Library",
  bringToFront: async () => undefined,
  evaluate: async () => undefined,
};

test("the transcript records each call with its answer, names silence, and keeps the adapter's own lines", async () => {
  const session = createReaderSession(fakeAdapter());
  await session.start();
  assert.equal(await session.enter(page), "link, Skip to main content");
  assert.equal(await session.perform("moveToNextTable"), "");
  assert.equal(await session.press("Control+Home"), "pressed");
  assert.deepEqual(await session.capture(async () => 42), { result: 42, spoken: "1 row selected" });
  assert.deepEqual(session.transcript, [
    "launched on the first attempt",
    "start NVDA: ok",
    "### focus guard: in the document",
    `moveToNextTable: ${SILENCE}`,
    "press Control+Home: pressed",
    "page action: 1 row selected",
  ]);
  assert.deepEqual(await session.environment(), ["windows: test"]);
});

test("typing is one call with one answer, and the transcript names the text and the pace", async () => {
  const adapter = fakeAdapter();
  const session = createReaderSession(adapter);
  assert.equal(await session.type("ban"), "b. a. n");
  assert.equal(await session.type("a b", { delay: 150 }), "b. a. n");
  assert.deepEqual(adapter.calls, ["type ban no delay", "type a b 150"]);
  assert.deepEqual(session.transcript, ['type "ban": b. a. n', 'type "a b", 150 ms between keys: b. a. n']);
});

test("a call that throws synchronously rejects, and leaves a line saying why", async () => {
  const session = createReaderSession(fakeAdapter());
  const pending = session.perform("nope");
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, /unknown NVDA keyboard command: nope/);
  assert.deepEqual(session.transcript, ["nope: failed: unknown NVDA keyboard command: nope"]);
});

test("a failed page action is recorded, not skipped", async () => {
  const session = createReaderSession(fakeAdapter());
  await assert.rejects(
    session.capture(async () => {
      throw new Error("click failed", { cause: new Error("element detached") });
    }),
    /click failed/,
  );
  assert.deepEqual(session.transcript, ["page action: failed: click failed <- element detached"]);
});

test("calls run one after another, in the order they were made", async () => {
  let release!: () => void;
  const adapter = fakeAdapter({
    async next() {
      adapter.calls.push("next started");
      await new Promise<void>((resolve) => (release = resolve));
      adapter.calls.push("next finished");
      return "row 2";
    },
  });
  const session = createReaderSession(adapter);
  const both = Promise.all([session.next(), session.press("Tab")]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(adapter.calls, ["next started"]);
  release();
  await both;
  assert.deepEqual(adapter.calls, ["next started", "next finished", "press Tab"]);
});

test("a failed call does not stop the calls queued behind it", async () => {
  const session = createReaderSession(fakeAdapter());
  const [first, second] = await Promise.allSettled([session.perform("nope"), session.next()]);
  assert.equal(first.status, "rejected");
  assert.deepEqual(second, { status: "fulfilled", value: "row 2" });
});

test("a reader call from inside a capture's action is refused rather than waiting for itself", async () => {
  const session = createReaderSession(fakeAdapter());
  await assert.rejects(
    session.capture(() => session.next()),
    /a capture's action must not call the reader/,
  );
  // The session is still usable afterwards.
  assert.equal(await session.next(), "row 2");
});

test("start restarts a reader that is already up", async () => {
  const adapter = fakeAdapter();
  const session = createReaderSession(adapter);
  await session.start();
  await session.start();
  assert.deepEqual(adapter.calls, ["start", "stop", "start"]);
});

test("a start that fails is recorded with its cause chain", async () => {
  const session = createReaderSession(
    fakeAdapter({
      async start(record) {
        record("start VoiceOver (attempt 1): Application isn't running. (-600)");
        throw new Error("VoiceOver cannot be started");
      },
      reader: "voiceover",
    }),
  );
  await assert.rejects(session.start(), /cannot be started/);
  assert.deepEqual(session.transcript, [
    "start VoiceOver (attempt 1): Application isn't running. (-600)",
    "start VoiceOver: failed: VoiceOver cannot be started",
  ]);
});

test("a failed entry throws with the whole transcript, ending in the reason", async () => {
  const session = createReaderSession(
    fakeAdapter({
      async enter(_page, _options, record) {
        record("focus attempt 6: menu");
        throw new Error("FOCUS GUARD FAILED: focus never reached the document");
      },
    }),
  );
  await session.start();
  await assert.rejects(
    session.enter(page),
    /NVDA did not reach the page:\nlaunched on the first attempt\nstart NVDA: ok\nfocus attempt 6: menu\n### NVDA DID NOT REACH THE PAGE\nFOCUS GUARD FAILED: focus never reached the document$/,
  );
});

test("stop never throws, and records why it failed", async () => {
  const session = createReaderSession(
    fakeAdapter({
      async stop() {
        throw new Error("already gone");
      },
    }),
  );
  await session.stop();
  assert.deepEqual(session.transcript, ["stop NVDA: already gone"]);
});

test("stop does not wait behind a call that hung", async () => {
  const adapter = fakeAdapter({
    next: () => new Promise<string>(() => undefined),
  });
  const session = createReaderSession(adapter);
  void session.next();
  await session.stop();
  assert.ok(adapter.calls.includes("stop"));
});

test("errorChain walks the causes and stops at a non-error", () => {
  const error = new Error("outer", { cause: new Error("middle", { cause: "inner" }) });
  assert.deepEqual(errorChain(error), ["outer", "middle", "inner"]);
  assert.deepEqual(errorChain(undefined), []);
});
