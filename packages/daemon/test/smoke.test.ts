/**
 * The Smoke's sequence, against a fake session: it waits for the daemon,
 * proves the page through the same `ReaderSession` a test has, asks its
 * commands, and stops the reader and lets go of the browser whatever
 * happened. Whether the real daemon answers is what running it is for.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage, ReaderSession } from "@sr-receipts/host";

import { SMOKE_COMMANDS } from "../src/lib/smoke-result.ts";
import { runSmoke } from "../src/smoke.ts";

interface Fake extends ReaderSession {
  calls: string[];
}

function fakeSession({ answers = ["title", "", "table", "table"], environmentFails = 0, enterFails = false }: { answers?: string[]; environmentFails?: number; enterFails?: boolean } = {}): Fake {
  const calls: string[] = [];
  let asked = 0;
  let health = 0;
  return {
    calls,
    reader: "nvda",
    transcript: [],
    async environment() {
      health += 1;
      if (health <= environmentFails) throw new Error("fetch failed");
      return ["windows: test"];
    },
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    async enter() {
      calls.push("enter");
      if (enterFails) throw new Error("NVDA did not reach the page:\nFOCUS GUARD FAILED: the browser is not in front");
      return "link";
    },
    async perform(command) {
      calls.push(`perform ${command}`);
      return answers[asked++] ?? "";
    },
    press: async () => "",
    next: async () => "",
    previous: async () => "",
    capture: async (action) => ({ result: await action(), spoken: "" }),
    spokenPhraseLog: async () => [],
    clearSpokenPhraseLog: async () => undefined,
  };
}

const page: EntryPage = { title: async () => "Control", bringToFront: async () => undefined, evaluate: async () => undefined };

function browser(calls: string[]) {
  return async () => {
    calls.push("open");
    return { page, close: async () => void calls.push("close") };
  };
}

test("the rig is proved by the daemon answering, the guard passing, and a command speaking, through one session", async () => {
  const session = fakeSession();
  const result = await runSmoke({ session, open: browser(session.calls) });
  assert.deepEqual(result, { ok: true, daemon: true, entered: true, commands: SMOKE_COMMANDS.length, spoke: 3, error: null, environment: ["windows: test"] });
  assert.deepEqual(session.calls, ["start", "open", "enter", ...SMOKE_COMMANDS.map((command) => `perform ${command}`), "stop", "close"]);
});

test("a daemon still starting is waited for, and one that never answers is the failure", async () => {
  const waited: number[] = [];
  const delay = async (ms: number) => void waited.push(ms);
  const slow = fakeSession({ environmentFails: 2 });
  assert.equal((await runSmoke({ session: slow, open: browser(slow.calls), delay })).ok, true);
  assert.deepEqual(waited, [1000, 1000]);

  const never = fakeSession({ environmentFails: Infinity });
  const result = await runSmoke({ session: never, open: browser(never.calls), waitMs: 0, delay });
  assert.equal(result.ok, false);
  assert.equal(result.daemon, false);
  assert.match(result.error ?? "", /did not answer within 0 s.*<- fetch failed/);
  // Nothing was started, and the reader was still stopped for good measure.
  assert.deepEqual(never.calls, ["stop"]);
});

test("a guard that fails is not entry, and the reader and browser are still let go", async () => {
  const session = fakeSession({ enterFails: true });
  const result = await runSmoke({ session, open: browser(session.calls) });
  assert.equal(result.ok, false);
  assert.equal(result.daemon, true);
  assert.equal(result.entered, false);
  assert.match(result.error ?? "", /FOCUS GUARD FAILED/);
  assert.deepEqual(session.calls, ["start", "open", "enter", "stop", "close"]);
});

test("a page that was reached but never spoke does not prove the rig", async () => {
  const session = fakeSession({ answers: ["", "", "", ""] });
  const result = await runSmoke({ session, open: browser(session.calls) });
  assert.equal(result.entered, true);
  assert.equal(result.spoke, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error, null);
});
