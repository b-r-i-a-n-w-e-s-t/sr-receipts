/**
 * The wire, end to end: the host's real NVDA session against this package's
 * real daemon, with only the desktop faked.
 *
 * Each side used to be tested against its own stand-in for the other, so
 * nothing proved they agreed. What is proved here is what crosses: the
 * token, a refusal's status, a reader failure's cause chain, the page's title
 * and probes for the guards, the capture window's two routes around a page
 * action, and the stamp.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, RigError, SILENCE, createNvdaSession, type EntryPage } from "@sr-receipts/host";

import { createRigServer } from "../src/lib/daemon.ts";
import type { NvdaDesktop } from "../src/lib/nvda.ts";

const TOKEN = "test-token";
const TITLE = "Component Library";

interface Fake extends NvdaDesktop {
  calls: string[];
  /** What activation leaves in front; the guards fail unless it is the page. */
  foreground: string;
}

function fakeDesktop(): Fake {
  const calls: string[] = [];
  const fake: Fake = {
    calls,
    foreground: `${TITLE} - Microsoft Edge`,
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    async perform(command) {
      calls.push(command);
      switch (command) {
        case "reportTitle":
          return fake.foreground;
        case "reportCurrentFocus":
          return `${TITLE}, document`;
        case "moveToNextHeading":
          return "heading level 1, Component Library";
        case "moveToNextTable":
        case "exitFocusMode":
          return "";
        default:
          throw new Error(`unknown NVDA keyboard command: ${command}`, { cause: new Error("from guidepup") });
      }
    },
    async press(key) {
      calls.push(`press ${key}`);
      return key === "Control+Home" ? "link, Skip to main content" : "";
    },
    async type(text, delayMs) {
      calls.push(`type ${JSON.stringify(text)} ${delayMs}`);
      return "b. a. n";
    },
    next: async () => "row 2",
    previous: async () => "row 1",
    spokenPhraseLog: async () => ["a", "b"],
    clearSpokenPhraseLog: async () => void calls.push("clear"),
    captureBegin: async () => void calls.push("capture begin"),
    async captureEnd() {
      calls.push("capture end");
      return "1 row selected";
    },
    windows: async () => ["msedge: Component Library", "WindowsTerminal: Administrator"],
    async activateBrowser() {
      calls.push("activate");
      return fake.foreground;
    },
    environment: async () => ["windows: test", "edge: test"],
  };
  return fake;
}

async function daemon(t: test.TestContext): Promise<{ url: string; desktop: Fake }> {
  const desktop = fakeDesktop();
  const server = createRigServer({ token: TOKEN, desktop, browser: { port: 8766, path: `/${TOKEN}` } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, desktop };
}

const page: EntryPage = {
  title: async () => TITLE,
  bringToFront: async () => undefined,
  evaluate: async () => undefined,
};

test("a wrong token is refused as a RigError with its status, before the reader starts", async (t) => {
  const { url, desktop } = await daemon(t);
  const session = createNvdaSession({ url, token: "nope" });
  await assert.rejects(session.start(), (error: unknown) => error instanceof RigError && error.status === 403);
  assert.deepEqual(desktop.calls, []);
});

/** A daemon from another release: `/health` reports `protocol`, and every route asked is kept. */
async function otherRelease(t: test.TestContext, protocol: number | undefined): Promise<{ url: string; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...(protocol !== undefined && { protocol }), started: false, browser: { port: 8766, path: `/${TOKEN}` }, rig: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}

test("a daemon on another protocol version, or none, is refused at start with both named, before the reader starts", async (t) => {
  for (const protocol of [PROTOCOL_VERSION + 1, undefined]) {
    const { url, asked } = await otherRelease(t, protocol);
    await assert.rejects(
      createNvdaSession({ url, token: TOKEN }).start(),
      new RegExp(`speaks wire protocol ${protocol ?? "none"}, and this host speaks ${PROTOCOL_VERSION}`),
    );
    assert.deepEqual(asked, ["GET /health"]);
  }
});

test("the guards run on the guest with the page's title and probes, and their lines reach the transcript", async (t) => {
  const { url, desktop } = await daemon(t);
  const session = createNvdaSession({ url, token: TOKEN });
  await session.start();
  assert.equal(await session.enter(page, { modeProbes: ["moveToNextHeading"] }), "link, Skip to main content");
  assert.ok(desktop.calls.includes("moveToNextHeading"));
  assert.ok(!desktop.calls.includes("moveToNextTable"), "the default probes were used instead of the page's own");
  assert.equal(session.transcript[0], "start NVDA: ok");
  assert.match(session.transcript.join("\n"), /### focus guard: in the document, in browse mode \(proved by moveToNextHeading\)/);
});

test("a failed entry rejects with the guest's diagnosis, ending in the guard's verdict", async (t) => {
  const { url, desktop } = await daemon(t);
  desktop.foreground = "Administrator: Windows PowerShell";
  const session = createNvdaSession({ url, token: TOKEN });
  await session.start();
  await assert.rejects(session.enter(page), (error: Error) => {
    assert.match(error.message, /^NVDA did not reach the page:\n/);
    assert.match(error.message, /title reported: Administrator: Windows PowerShell\n/);
    assert.match(error.message, /### windows on screen\nmsedge: Component Library\nWindowsTerminal: Administrator\n### NVDA DID NOT REACH THE PAGE\nFOCUS GUARD FAILED: the browser is not in front \(page title "Component Library"\)$/);
    return true;
  });
});

test("each answer crosses as it was said, and the transcript names silence", async (t) => {
  const { url } = await daemon(t);
  const session = createNvdaSession({ url, token: TOKEN });
  await session.start();
  assert.equal(await session.perform("moveToNextTable"), "");
  assert.equal(await session.press("Control+Home"), "link, Skip to main content");
  assert.equal(await session.next(), "row 2");
  assert.deepEqual(await session.spokenPhraseLog(), ["a", "b"]);
  await session.clearSpokenPhraseLog();
  assert.deepEqual(session.transcript.slice(1), [`moveToNextTable: ${SILENCE}`, "press Control+Home: link, Skip to main content", "next: row 2"]);
});

test("typing crosses with its text and its pace, and a pace left out is none", async (t) => {
  const { url, desktop } = await daemon(t);
  const session = createNvdaSession({ url, token: TOKEN });
  assert.equal(await session.type("ban", { delay: 120 }), "b. a. n");
  assert.equal(await session.type("a b"), "b. a. n");
  assert.deepEqual(desktop.calls, ['type "ban" 120', 'type "a b" 0']);
  assert.deepEqual(session.transcript, ['type "ban", 120 ms between keys: b. a. n', 'type "a b": b. a. n']);
});

test("a reader failure on the guest arrives with its whole cause chain, and is recorded", async (t) => {
  const { url } = await daemon(t);
  const session = createNvdaSession({ url, token: TOKEN });
  await assert.rejects(session.perform("nope"), (error: unknown) => {
    assert.ok(error instanceof RigError);
    assert.equal(error.status, 500);
    assert.match(error.message, /POST \/reader\/perform: unknown NVDA keyboard command: nope <- from guidepup/);
    return true;
  });
  assert.match(session.transcript.at(-1) ?? "", /^nope: failed: POST \/reader\/perform: unknown NVDA keyboard command: nope/);
});

test("capture opens the window before the page action and closes it after, even when the action throws", async (t) => {
  const { url, desktop } = await daemon(t);
  const session = createNvdaSession({ url, token: TOKEN });
  const captured = await session.capture(async () => {
    desktop.calls.push("page click");
    return 42;
  });
  assert.deepEqual(captured, { result: 42, spoken: "1 row selected" });
  assert.deepEqual(desktop.calls, ["capture begin", "page click", "capture end"]);

  desktop.calls.length = 0;
  await assert.rejects(
    session.capture(async () => {
      throw new Error("click failed");
    }),
    /click failed/,
  );
  assert.deepEqual(desktop.calls, ["capture begin", "capture end"]);
  assert.deepEqual(session.transcript, ["page action: 1 row selected", "page action: failed: click failed"]);
});

test("the stamp crosses from the guest's desktop", async (t) => {
  const { url } = await daemon(t);
  assert.deepEqual(await createNvdaSession({ url, token: TOKEN }).environment(), ["windows: test", "edge: test"]);
});

test("an unreachable daemon says what to check, and stop never throws", async () => {
  const session = createNvdaSession({ url: "http://127.0.0.1:1", token: TOKEN });
  await assert.rejects(session.start(), /is the VM booted, signed in, and nvda-daemon running/);
  await session.stop();
  assert.match(session.transcript.at(-1) ?? "", /^stop NVDA: /);
});
