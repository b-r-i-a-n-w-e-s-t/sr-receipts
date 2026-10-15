/**
 * The fixture, tested without Playwright or a reader: which session a
 * project gets, what VoiceOver is told to activate, what a missing VoiceOver
 * package says, and that every test's reader is stopped and leaves its
 * receipt.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { ReaderSession } from "@sr-receipts/host";

import { applicationNameFor, createSession, environmentStamp, loadVoiceOver, readerFixture, readerFixtures, withReader } from "../src/fixture.ts";

test("VoiceOver activates the application Playwright launched, by browser or channel", () => {
  assert.equal(applicationNameFor("webkit", undefined), "Playwright");
  assert.equal(applicationNameFor("chromium", undefined), "Google Chrome for Testing");
  assert.equal(applicationNameFor("chromium", "chrome"), "Google Chrome");
  assert.equal(applicationNameFor("chromium", "msedge"), "Microsoft Edge");
  assert.equal(applicationNameFor("firefox", undefined), "Nightly");
});

test("an NVDA project gets a session over the wire and never loads VoiceOver", async () => {
  const session = await createSession({ reader: "nvda", url: "http://127.0.0.1:1", token: "t" }, { browserName: "chromium", channel: "msedge" }, async () => {
    throw new Error("must not be loaded");
  });
  assert.equal(session.reader, "nvda");
});

test("a VoiceOver project loads VoiceOver and passes the application name through", async () => {
  const names: string[] = [];
  const session = await createSession({ reader: "voiceover" }, { browserName: "webkit", channel: undefined }, async () => ({
    createVoiceOverSession: ({ applicationName }) => {
      names.push(applicationName);
      return { reader: "voiceover" } as never;
    },
  }));
  assert.equal(session.reader, "voiceover");
  assert.deepEqual(names, ["Playwright"]);
  await createSession({ reader: "voiceover", applicationName: "Safari" }, { browserName: "webkit", channel: undefined }, async () => ({
    createVoiceOverSession: ({ applicationName }) => {
      names.push(applicationName);
      return { reader: "voiceover" } as never;
    },
  }));
  assert.equal(names[1], "Safari");
});

test("a VoiceOver project without VoiceOver installed says what to install", async () => {
  await assert.rejects(
    loadVoiceOver(async () => {
      throw Object.assign(new Error("Cannot find package '@sr-receipts/voiceover'"), { code: "ERR_MODULE_NOT_FOUND" });
    }),
    /needs @sr-receipts\/voiceover installed beside @sr-receipts\/playwright/,
  );
  await assert.rejects(
    loadVoiceOver(async () => {
      throw Object.assign(new Error("Cannot find module 'plist'"), { code: "ERR_MODULE_NOT_FOUND" });
    }),
    /Cannot find module 'plist'/,
  );
});

test("the environment stamp names the browser once: the guest's for NVDA, Playwright's for VoiceOver", () => {
  const guest = ["windows: 24H2", "edge: 153.0.4234.48 at msedge.exe, driven by playwright-core 1.63.0"];
  assert.deepEqual(environmentStamp("nvda", guest, { name: "chromium", version: "153.0.4234.48" }), guest);
  const mac = ["macos: 26.6.2", "voiceover: bundled with macOS"];
  assert.deepEqual(environmentStamp("voiceover", mac, { name: "webkit", version: "26.4" }), [...mac, "browser: webkit 26.4"]);
});

/** A session that records what the fixture did with it. */
function fakeSession(calls: string[], overrides: Partial<ReaderSession> = {}): ReaderSession {
  return {
    reader: "voiceover",
    transcript: ["start VoiceOver: ok", "next: row 2"],
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    environment: async () => ["macos: 26.6.2"],
    ...overrides,
  } as ReaderSession;
}

function run(session: ReaderSession, calls: string[], body: (session: ReaderSession) => Promise<void> = async () => undefined) {
  const attached: Record<string, string> = {};
  const fixture = readerFixture(async () => {
    calls.push("create");
    return session;
  });
  const done = fixture(
    { readerOptions: { reader: "voiceover" }, browser: { version: () => "26.4" }, browserName: "webkit", channel: undefined },
    async (given) => {
      calls.push("use");
      assert.equal(given, session);
      await body(given);
    },
    { attach: async (name, { body }) => void (attached[name] = body) },
  );
  return { done, attached };
}

test("the fixture starts the reader, hands it to the test, stops it, and attaches the receipt", async () => {
  const calls: string[] = [];
  const { done, attached } = run(fakeSession(calls), calls);
  await done;
  assert.deepEqual(calls, ["create", "start", "use", "stop"]);
  assert.deepEqual(attached, {
    "reader-transcript": "start VoiceOver: ok\nnext: row 2",
    environment: "macos: 26.6.2\nbrowser: webkit 26.4",
  });
});

test("a failing test still stops the reader and gets its receipt, and the failure is the test's", async () => {
  const calls: string[] = [];
  const { done, attached } = run(fakeSession(calls), calls, async () => {
    throw new Error("expected the reader to announce");
  });
  await assert.rejects(done, /expected the reader to announce/);
  assert.deepEqual(calls, ["create", "start", "use", "stop"]);
  assert.ok(attached["reader-transcript"]);
  assert.ok(attached.environment);
});

test("a reader that never starts still leaves its receipt, with every start attempt, and the failure is the start's", async () => {
  const calls: string[] = [];
  const transcript = ["start VoiceOver (attempt 1): -600", "start VoiceOver (attempt 2): -600"];
  const session = fakeSession(calls, {
    transcript,
    start: async () => {
      calls.push("start");
      throw new Error("VoiceOver cannot be started");
    },
  });
  const { done, attached } = run(session, calls);
  await assert.rejects(done, /VoiceOver cannot be started/);
  assert.deepEqual(calls, ["create", "start", "stop"]);
  assert.equal(attached["reader-transcript"], transcript.join("\n"));
  assert.ok(attached.environment);
});

test("a stamp that cannot be read is attached as unavailable rather than failing the test", async () => {
  const calls: string[] = [];
  const session = fakeSession(calls, {
    environment: async () => {
      throw new Error("daemon went away");
    },
  });
  const { done, attached } = run(session, calls);
  await done;
  assert.match(attached.environment ?? "", /^environment unavailable: daemon went away/);
});

test("a project with no readerOptions fails before any reader is built", async () => {
  const calls: string[] = [];
  const fixture = readerFixture(async () => {
    calls.push("create");
    return fakeSession(calls);
  });
  await assert.rejects(
    fixture({ readerOptions: undefined, browser: { version: () => "" }, browserName: "webkit", channel: undefined }, async () => undefined, {
      attach: async () => undefined,
    }),
    /this project has no readerOptions/,
  );
  assert.deepEqual(calls, []);
});

test("withReader extends the consumer's own test with the reader fixtures", () => {
  const extended: unknown[] = [];
  withReader({ extend: (fixtures: unknown) => extended.push(fixtures) } as never);
  assert.deepEqual(extended, [readerFixtures]);
});
