/**
 * The client and the NVDA session against a fake daemon.
 *
 * What is worth proving without a guest: that every call carries the token,
 * that a refusal arrives as a RigError with its status, that the capture
 * window is opened before the page action runs and closed after it whatever
 * the action did, that a failed entry throws with the guest's diagnosis, and
 * that the transcript names silence.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createNvdaSession, connectReader, RigError, SILENCE } from "../src/client.ts";
import type { EntryPage } from "../src/protocol.ts";

const TOKEN = "test-token";

interface Fake {
  url: string;
  server: Server;
  /** Every request, as `METHOD /path body`. */
  calls: string[];
  /** What the next `/reader/enter` answers. */
  entry: { ok: boolean; arrivedOn: string; lines: string[] };
}

async function fakeDaemon(t: test.TestContext): Promise<Fake> {
  const calls: string[] = [];
  const fake: Fake = {
    url: "",
    calls,
    entry: { ok: true, arrivedOn: "link, Skip to main content", lines: ["### focus guard: in the document"] },
    server: createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const reply = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(403, { error: "token not accepted" });
        calls.push(`${req.method} ${req.url}${raw ? ` ${raw}` : ""}`);
        switch (`${req.method} ${req.url}`) {
          case "GET /health":
            return reply(200, { ok: true, started: false, browser: { port: 8766, path: "/x" }, rig: ["windows: test"] });
          case "POST /reader/enter":
            return reply(200, fake.entry);
          case "POST /reader/perform": {
            const { command } = JSON.parse(raw) as { command: string };
            if (command === "nope") return reply(500, { error: ["unknown NVDA keyboard command: nope", "from guidepup"] });
            return reply(200, { spoken: command === "moveToNextTable" ? "" : "said" });
          }
          case "POST /reader/press":
          case "POST /reader/next":
          case "POST /reader/previous":
          case "POST /reader/capture/end":
            return reply(200, { spoken: "heard" });
          case "GET /reader/log":
            return reply(200, { phrases: ["a", "b"] });
          case "POST /reader/start":
          case "POST /reader/stop":
          case "POST /reader/clear":
          case "POST /reader/capture/begin":
            return reply(200, { ok: true });
          case "POST /desktop/activate":
            return reply(200, { foreground: "Edge" });
          case "GET /desktop/windows":
            return reply(200, { windows: ["msedge: page - Microsoft Edge"] });
          default:
            return reply(404, { error: `no route for ${req.method} ${req.url}` });
        }
      });
    }),
  };
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => fake.server.close(() => resolve())));
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  return fake;
}

const page = (title = "Component Library"): EntryPage => ({
  title: async () => title,
  bringToFront: async () => undefined,
  evaluate: async () => undefined,
});

test("every route carries the token, and a refusal is a RigError with its status", async (t) => {
  const fake = await fakeDaemon(t);
  const wrong = connectReader({ url: fake.url, token: "nope" });
  await assert.rejects(wrong.health(), (error: unknown) => error instanceof RigError && error.status === 403);

  const reader = connectReader({ url: fake.url, token: TOKEN });
  assert.deepEqual(await reader.log(), ["a", "b"]);
  assert.equal(await reader.activateBrowser(), "Edge");
  assert.deepEqual(await reader.windows(), ["msedge: page - Microsoft Edge"]);
  assert.match(fake.calls[0] ?? "", /^GET \/reader\/log$/);
});

test("a reader failure on the guest arrives with its whole cause chain", async (t) => {
  const fake = await fakeDaemon(t);
  const reader = connectReader({ url: fake.url, token: TOKEN });
  await assert.rejects(reader.perform("nope"), (error: unknown) => {
    assert.ok(error instanceof RigError);
    assert.equal(error.status, 500);
    assert.match(error.message, /POST \/reader\/perform: unknown NVDA keyboard command: nope <- from guidepup/);
    return true;
  });
});

test("the session enters through the page's title and records the guest's guard lines", async (t) => {
  const fake = await fakeDaemon(t);
  const session = createNvdaSession({ url: fake.url, token: TOKEN });
  await session.start();
  const arrivedOn = await session.enter(page(), { modeProbes: ["moveToNextHeading"] });
  assert.equal(arrivedOn, "link, Skip to main content");
  assert.ok(fake.calls.includes('POST /reader/enter {"pageTitle":"Component Library","modeProbes":["moveToNextHeading"]}'));
  assert.deepEqual(session.transcript, ["start NVDA: ok", "### focus guard: in the document"]);
});

test("a failed entry throws with the diagnosis, and the transcript keeps it", async (t) => {
  const fake = await fakeDaemon(t);
  fake.entry = { ok: false, arrivedOn: "", lines: ["### FOCUS GUARD FAILED", "focus attempt 6: menu"] };
  const session = createNvdaSession({ url: fake.url, token: TOKEN });
  await session.start();
  await assert.rejects(session.enter(page()), /did not reach the page in browse mode:\n### FOCUS GUARD FAILED\nfocus attempt 6: menu/);
  assert.ok(session.transcript.includes("focus attempt 6: menu"));
});

test("capture opens the window before the action and closes it after, even when the action throws", async (t) => {
  const fake = await fakeDaemon(t);
  const session = createNvdaSession({ url: fake.url, token: TOKEN });
  await session.start();
  fake.calls.length = 0;

  const captured = await session.capture(async () => {
    fake.calls.push("page click");
    return 42;
  });
  assert.deepEqual(captured, { result: 42, spoken: "heard" });
  assert.deepEqual(fake.calls, ["POST /reader/capture/begin", "page click", "POST /reader/capture/end"]);

  fake.calls.length = 0;
  await assert.rejects(
    session.capture(async () => {
      throw new Error("click failed");
    }),
    /click failed/,
  );
  assert.deepEqual(fake.calls, ["POST /reader/capture/begin", "POST /reader/capture/end"]);
});

test("the transcript names silence, and each answer is returned as it was said", async (t) => {
  const fake = await fakeDaemon(t);
  const session = createNvdaSession({ url: fake.url, token: TOKEN });
  await session.start();
  assert.equal(await session.perform("moveToNextTable"), "");
  assert.equal(await session.press("Control+Home"), "heard");
  assert.equal(await session.next(), "heard");
  assert.deepEqual(session.transcript.slice(1), [`moveToNextTable: ${SILENCE}`, "press Control+Home: heard", "next: heard"]);
  assert.deepEqual(await session.environment(), ["windows: test"]);
});

test("an unreachable daemon says what to check, and stop never throws", async () => {
  const session = createNvdaSession({ url: "http://127.0.0.1:1", token: TOKEN });
  await assert.rejects(session.start(), /is the VM booted, signed in, and nvda-daemon running/);
  await session.stop();
  assert.match(session.transcript[0] ?? "", /^stop NVDA: /);
});
