/**
 * The fixture, tested without Playwright or a reader: which session a
 * project gets, what VoiceOver is told to activate, what a missing VoiceOver
 * package says, and that every test's reader is stopped and leaves its
 * receipt.
 *
 * Run: npm test
 */
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

import type { ReaderSession } from "@sr-receipts/host";

import {
  applicationNameFor,
  createSession,
  environmentStamp,
  loadVoiceOver,
  readerFixture,
  readerBrowser,
  readerFixtures,
  readerPreflight,
  withReader,
} from "../src/fixture.ts";

test("VoiceOver activates the application Playwright launched, by browser or channel", () => {
  assert.equal(applicationNameFor("webkit", undefined), "Playwright");
  assert.equal(applicationNameFor("chromium", undefined), "Google Chrome for Testing");
  assert.equal(applicationNameFor("chromium", "chrome"), "Google Chrome");
  assert.equal(applicationNameFor("chromium", "msedge"), "Microsoft Edge");
  assert.equal(applicationNameFor("firefox", undefined), "Nightly");
});

test("an NVDA project gets a session over the wire and never loads VoiceOver", async () => {
  const session = await createSession({ reader: "nvda", url: "http://127.0.0.1:1", token: "t" }, { browserName: "chromium", channel: "msedge" }, {}, async () => {
    throw new Error("must not be loaded");
  });
  assert.equal(session.reader, "nvda");
});

test("a VoiceOver project loads VoiceOver and passes the application name through", async () => {
  const names: string[] = [];
  const session = await createSession({ reader: "voiceover" }, { browserName: "webkit", channel: undefined }, {}, async () => ({
    createVoiceOverSession: ({ applicationName }) => {
      names.push(applicationName);
      return { reader: "voiceover" } as never;
    },
  }));
  assert.equal(session.reader, "voiceover");
  assert.deepEqual(names, ["Playwright"]);
  await createSession({ reader: "voiceover", applicationName: "Safari" }, { browserName: "webkit", channel: undefined }, {}, async () => ({
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

test("the environment stamp names the browser once: the guest's for NVDA with this run's Playwright driving it, Playwright's for VoiceOver", () => {
  const guest = ["windows: 24H2", "edge: 153.0.4234.48 at msedge.exe"];
  assert.deepEqual(environmentStamp("nvda", guest, { name: "chromium", version: "153.0.4234.48" }, "1.65.1"), [...guest, "playwright: 1.65.1 over CDP"]);
  const mac = ["macos: 26.6.2", "voiceover: bundled with macOS"];
  assert.deepEqual(environmentStamp("voiceover", mac, { name: "webkit", version: "26.4" }, "1.65.1"), [...mac, "browser: webkit 26.4"]);
});

/** Playwright's browser types, recording how each was asked for a browser. */
function fakePlaywright(calls: string[]) {
  const browser = { close: async () => void calls.push("close") };
  const type = (name: string) => ({
    launch: async (...args: unknown[]) => (calls.push(`${name} launch ${JSON.stringify(args)}`), browser),
    connectOverCDP: async (url: string, options: unknown) => (calls.push(`${name} connectOverCDP ${url} ${JSON.stringify(options)}`), browser),
  });
  return { browser, playwright: { chromium: type("chromium"), firefox: type("firefox"), webkit: type("webkit") } };
}

test("an NVDA worker's browser is the guest's Edge over CDP at the daemon's /browser, with the token as a header, and is let go after", async () => {
  const calls: string[] = [];
  const { browser, playwright } = fakePlaywright(calls);
  await readerBrowser()({ playwright, browserName: "chromium", readerOptions: { reader: "nvda", url: "http://guest:8765", token: "t" } }, async (given) => {
    assert.equal(given, browser);
    calls.push("use");
  });
  assert.deepEqual(calls, ['chromium connectOverCDP ws://guest:8765/browser {"headers":{"authorization":"Bearer t"}}', "use", "close"]);
});

test("any other worker's browser is launched here as Playwright's own would be, with the project's launch options", async () => {
  for (const readerOptions of [{ reader: "voiceover" } as const, undefined]) {
    const calls: string[] = [];
    const { playwright } = fakePlaywright(calls);
    await readerBrowser()({ playwright, browserName: "webkit", readerOptions }, async () => void calls.push("use"));
    // No arguments: Playwright's `_browserOptions` fixture has already made
    // the project's headless, channel and launchOptions the defaults.
    assert.deepEqual(calls, ["webkit launch []", "use", "close"]);
  }
});

const NVDA = { reader: "nvda", url: "http://guest:8765", token: "t" } as const;

test("the preflight asks the host's check for an NVDA worker, and never for VoiceOver or a project without a reader", async () => {
  const asked: string[] = [];
  const used: string[] = [];
  const use = async () => void used.push("use");
  const preflight = readerPreflight(async ({ url }) => void asked.push(url));
  await preflight({ readerOptions: NVDA }, use);
  await preflight({ readerOptions: { reader: "voiceover" } }, use);
  await preflight({ readerOptions: undefined }, use);
  assert.deepEqual(asked, ["http://guest:8765"]);
  assert.deepEqual(used, ["use", "use", "use"]);
});

test("a check that refuses the guest fails the preflight, before any browser connects", async () => {
  const used: string[] = [];
  const preflight = readerPreflight(async () => {
    throw new Error("the guest's Edge is not running");
  });
  await assert.rejects(preflight({ readerOptions: NVDA }, async () => void used.push("use")), /Edge is not running/);
  assert.deepEqual(used, []);
});

test("an unreachable daemon fails the preflight, named", async () => {
  await assert.rejects(
    readerPreflight()({ readerOptions: { reader: "nvda", url: "http://127.0.0.1:1", token: "t" } }, async () => undefined),
    /the guest daemon at http:\/\/127\.0\.0\.1:1 is not reachable/,
  );
});

/** A session that records what the fixture did with it. */
function fakeSession(calls: string[], overrides: Partial<ReaderSession> = {}): ReaderSession {
  return {
    reader: "voiceover",
    transcript: ["start VoiceOver: ok", "next: row 2"],
    steps: [{ call: "next", spoken: "row 2" }],
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    environment: async () => ["macos: 26.6.2"],
    ...overrides,
  } as ReaderSession;
}

/** Where a fake spec lives: a fresh directory, so a Receipt File the fixture writes can be read back. */
function specDirectory(): string {
  return mkdtempSync(join(tmpdir(), "receipt-file-"));
}

interface RunOptions {
  body?: (session: ReaderSession) => Promise<void>;
  root?: string;
  status?: string;
  retry?: number;
  receipt?: { state?: () => Record<string, unknown> };
  page?: { evaluate<R>(fn: () => R): Promise<R> };
  created?: { stateAfterStep?: (() => Promise<Record<string, string>>) | undefined }[];
}

function run(session: ReaderSession, calls: string[], options: RunOptions = {}) {
  const { body = async () => undefined, root = specDirectory(), status = "passed", retry = 0 } = options;
  const attached: Record<string, string> = {};
  const fixture = readerFixture(async (_options, _browser, sessionOptions) => {
    calls.push("create");
    options.created?.push(sessionOptions ?? {});
    return session;
  });
  const done = fixture(
    {
      readerOptions: { reader: "voiceover" },
      browser: { version: () => "26.4" },
      browserName: "webkit",
      channel: undefined,
      page: options.page ?? { evaluate: async () => assert.fail("no receipt state, so the page is never read") },
      receipt: options.receipt,
    },
    async (given) => {
      calls.push("use");
      assert.equal(given, session);
      await body(given);
    },
    {
      attach: async (name, { body }) => void (attached[name] = body),
      file: join(root, "receipts", "action-set.spec.ts"),
      line: 12,
      titlePath: ["receipts/action-set.spec.ts", "ActionSet", "basic walk"],
      project: { name: "voiceover" },
      status,
      retry,
      config: { rootDir: root, version: "1.65.1" },
    },
  );
  return { done, attached, receiptFile: join(root, "receipts", "action-set.spec.ts-receipts", "ActionSet-basic-walk--voiceover.md") };
}

test("the fixture writes the Receipt File beside the spec: a header that only a different run changes, the Steps, the Transcript", async () => {
  const calls: string[] = [];
  const session = fakeSession(calls, {
    transcript: ["start VoiceOver: ok", "### entry: web content", "press ArrowLeft: Delete, unavailable, 3 of 4", "next: (silence)", "nope: failed: unknown command <- because"],
    steps: [
      { call: "press ArrowLeft", spoken: "Delete, unavailable, 3 of 4" },
      { call: "next", spoken: "" },
      { call: "nope", error: "unknown command <- because" },
      { call: "page action", spoken: "a | b\nc" },
    ],
  });
  const { done, receiptFile } = run(session, calls);
  await done;
  assert.equal(
    readFileSync(receiptFile, "utf8"),
    `# ActionSet › basic walk

Reader: VoiceOver, project \`voiceover\`
Outcome: passed
Spec: \`receipts/action-set.spec.ts:12\`

## Environment

\`\`\`
macos: 26.6.2
browser: webkit 26.4
\`\`\`

## Steps

| # | Call | Reader said |
| --- | --- | --- |
| 1 | press ArrowLeft | Delete, unavailable, 3 of 4 |
| 2 | next | (silence) |
| 3 | nope | failed: unknown command <- because |
| 4 | page action | a \\| b c |

## Transcript

\`\`\`
start VoiceOver: ok
### entry: web content
press ArrowLeft: Delete, unavailable, 3 of 4
next: (silence)
nope: failed: unknown command <- because
\`\`\`
`,
  );
});

test("the Receipt File names the outcome and the retry, a failed start included, and a skipped test leaves the last one", async () => {
  const root = specDirectory();
  const outcome = (file: string) => readFileSync(file, "utf8").split("\n")[3];

  const retried = run(fakeSession([]), [], { root, status: "timedOut", retry: 1 });
  await retried.done;
  assert.equal(outcome(retried.receiptFile), "Outcome: timedOut, on retry 1");

  const neverStarted = run(fakeSession([], { start: async () => assert.fail("VoiceOver cannot be started") }), [], { root });
  await assert.rejects(neverStarted.done, /cannot be started/);
  assert.equal(outcome(neverStarted.receiptFile), "Outcome: failed");

  const skipped = run(fakeSession([], { steps: [] }), [], { root, status: "skipped" });
  await skipped.done;
  assert.equal(outcome(skipped.receiptFile), "Outcome: failed");
});

test("a receipt's state is read in the page after each Step, as text, and only when a spec asks for it", async () => {
  const created: RunOptions["created"] = [];
  await run(fakeSession([]), [], { created }).done;
  await run(fakeSession([]), [], { created, receipt: {} }).done;
  assert.equal(created[0]?.stateAfterStep, undefined);
  assert.equal(created[1]?.stateAfterStep, undefined);

  const evaluated: unknown[] = [];
  const page = {
    evaluate: async <R>(fn: () => R): Promise<R> => {
      evaluated.push(fn);
      return fn();
    },
  };
  const state = () => ({ "Focused after": "Edit", Expanded: false, Count: 3, Label: null });
  await run(fakeSession([]), [], { created, page, receipt: { state } }).done;
  assert.deepEqual(await created[2]?.stateAfterStep?.(), { "Focused after": "Edit", Expanded: "false", Count: "3", Label: "null" });
  assert.deepEqual(evaluated, [state]);
});

test("the page state is a column each, in the order first seen; a failed read is named in every cell of its row", async () => {
  const session = fakeSession([], {
    steps: [
      { call: "press ArrowLeft", spoken: "Delete", state: { "Focused after": "Delete 2/3", Expanded: "true" } },
      { call: "press Escape", spoken: "Edit", stateError: "page closed" },
      { call: "next", spoken: "row 2", state: { "Focused after": "", Value: "b" } },
    ],
  });
  const { done, receiptFile } = run(session, []);
  await done;
  const table = readFileSync(receiptFile, "utf8").split("## Steps\n\n")[1]?.split("\n\n")[0];
  assert.equal(
    table,
    `| # | Call | Reader said | Focused after | Expanded | Value |
| --- | --- | --- | --- | --- | --- |
| 1 | press ArrowLeft | Delete | Delete 2/3 | true |  |
| 2 | press Escape | Edit | (state failed: page closed) | (state failed: page closed) | (state failed: page closed) |
| 3 | next | row 2 | (empty) |  | b |`,
  );
});

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
  const { done, attached } = run(fakeSession(calls), calls, {
    body: async () => {
      throw new Error("expected the reader to announce");
    },
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
    fixture(
      { readerOptions: undefined, browser: { version: () => "" }, browserName: "webkit", channel: undefined, page: { evaluate: async () => undefined as never }, receipt: undefined },
      async () => undefined,
      { attach: async () => undefined, file: "/x.spec.ts", line: 1, titlePath: [], project: { name: "" }, status: "passed", retry: 0, config: { rootDir: "/", version: "1.65.1" } },
    ),
    /this project has no readerOptions/,
  );
  assert.deepEqual(calls, []);
});

test("withReader extends the consumer's own test with the reader fixtures", () => {
  const extended: unknown[] = [];
  withReader({ extend: (fixtures: unknown) => extended.push(fixtures) } as never);
  assert.deepEqual(extended, [readerFixtures]);
});
