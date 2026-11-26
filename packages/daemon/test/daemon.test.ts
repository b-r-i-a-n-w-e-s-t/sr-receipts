/**
 * The daemon, without the rig.
 *
 * `createRigServer` takes its desktop, so everything here except NVDA itself
 * runs on any machine. What is worth testing without a desktop is the part
 * that faces the network: who gets in, that a route's answer is the reader's,
 * that calls on one reader are serialized, that start and stop carry the
 * desktop's lines, and that a reader failure comes back as its cause chain
 * rather than a bare 500. Restarting and abandoned capture windows are the
 * desktop's, and are tested with it.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo, Socket } from "node:net";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";

import { PROTOCOL_VERSION, type DaemonHealth } from "@sr-receipts/host";
import { createRigServer, resolveToken } from "../src/lib/daemon.ts";
import type { Edge } from "../src/lib/edge.ts";
import type { NvdaDesktop } from "../src/lib/nvda.ts";

const TOKEN = "test-token";

interface Harness {
  url: string;
  server: Server;
  calls: string[];
  /** Resolves the `next()` in flight, for the serialization test. */
  release: (() => void) | null;
  /** The upgrade requests that reached the stand-in Edge. */
  edgeRequests: { path: string; headers: IncomingHttpHeaders }[];
  /** Why the stand-in Edge cannot start, when it cannot. */
  edgeDown: string | null;
}

/**
 * A stand-in for Edge's DevTools endpoint: it accepts any WebSocket upgrade
 * and echoes what it is sent. The pipe is what is under test, not CDP.
 */
async function standInEdge(t: test.TestContext, state: Harness): Promise<Pick<Edge, "endpoint" | "health">> {
  const server = createServer();
  server.on("upgrade", (req, socket: Socket) => {
    state.edgeRequests.push({ path: req.url ?? "", headers: req.headers });
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools/browser/abc`;
  return {
    async endpoint() {
      if (state.edgeDown) throw new Error(state.edgeDown);
      return endpoint;
    },
    health: async () => (state.edgeDown ? { running: false, error: state.edgeDown } : { running: true }),
  };
}

async function harness(t: test.TestContext): Promise<Harness> {
  const calls: string[] = [];
  const state: Harness = { url: "", calls, release: null, server: undefined as unknown as Server, edgeRequests: [], edgeDown: null };
  let up = false;
  const desktop: NvdaDesktop = {
    async start() {
      calls.push("start");
      const lines = up ? ["NVDA was still up: stopped it first"] : [];
      up = true;
      return lines;
    },
    async stop() {
      calls.push("stop");
      up = false;
      return ["abandoned capture window: closed, and what it heard discarded"];
    },
    started: () => up,
    async perform(command) {
      calls.push(`perform ${command}`);
      if (command === "nope") throw new Error("unknown NVDA keyboard command: nope", { cause: new Error("from guidepup") });
      return command === "reportTitle" ? "Component Library - Microsoft Edge" : "";
    },
    async press(key) {
      calls.push(`press ${key}`);
      return "";
    },
    async type(text, delayMs) {
      calls.push(`type ${JSON.stringify(text)} ${delayMs}`);
      return "b. a. n";
    },
    async next() {
      calls.push("next started");
      await new Promise<void>((resolve) => {
        state.release = resolve;
      });
      calls.push("next finished");
      return "row 2";
    },
    async previous() {
      return "row 1";
    },
    spokenPhraseLog: async () => ["a", "b"],
    async clearSpokenPhraseLog() {
      calls.push("clear");
    },
    async captureBegin() {
      calls.push("capture begin");
    },
    async captureEnd() {
      calls.push("capture end");
      return "1 row selected";
    },
    windows: async () => ["msedge: Component Library"],
    async activateBrowser() {
      calls.push("activate");
      return "Component Library - Microsoft Edge";
    },
    environment: async () => ["windows: test", "nvda: test"],
  };
  state.server = createRigServer({ token: TOKEN, desktop, edge: await standInEdge(t, state) });
  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => state.server.close(() => resolve())));
  state.url = `http://127.0.0.1:${(state.server.address() as AddressInfo).port}`;
  return state;
}

const auth = { authorization: `Bearer ${TOKEN}` };
const post = (url: string, path: string, body?: unknown) =>
  fetch(`${url}${path}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const get = (url: string, path: string) => fetch(`${url}${path}`, { headers: auth });

type Upgraded = { status: 101; socket: Socket } | { status: number; body: string };

/** A WebSocket upgrade, as a CDP client opens one, answered either way. */
function upgrade(url: string, path: string, headers: Record<string, string> = {}): Promise<Upgraded> {
  return new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, {
      headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.on("upgrade", (_res, socket: Socket) => resolve({ status: 101, socket }));
    req.on("response", (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("an upgrade on /browser with the token is piped both ways to Edge's endpoint, and the token stops at the daemon", async (t) => {
  const { url, edgeRequests } = await harness(t);
  const upgraded = await upgrade(url, "/browser", auth);
  assert.equal(upgraded.status, 101);
  const { socket } = upgraded as { socket: Socket };
  socket.write("ping");
  const echoed = await new Promise<string>((resolve) => socket.once("data", (chunk: Buffer) => resolve(chunk.toString())));
  // Before the servers close, which wait for every connection still open.
  socket.destroy();
  assert.equal(echoed, "ping");
  assert.equal(edgeRequests.length, 1);
  assert.equal(edgeRequests[0]?.path, "/devtools/browser/abc");
  assert.equal(edgeRequests[0]?.headers.authorization, undefined);
  assert.match(edgeRequests[0]?.headers.host ?? "", /^127\.0\.0\.1:\d+$/);
});

test("an upgrade on /browser with no token, or a wrong one, is refused before Edge is reached", async (t) => {
  const { url, edgeRequests } = await harness(t);
  assert.equal((await upgrade(url, "/browser")).status, 401);
  assert.equal((await upgrade(url, "/browser", { authorization: "Bearer nope" })).status, 403);
  assert.equal(edgeRequests.length, 0);
});

test("an upgrade anywhere but /browser is not found, and an Edge that cannot start is a 503 that says why", async (t) => {
  const state = await harness(t);
  assert.equal((await upgrade(state.url, "/devtools/browser/abc", auth)).status, 404);
  state.edgeDown = "Edge did not start from msedge.exe: ENOENT";
  const refused = await upgrade(state.url, "/browser", auth);
  assert.equal(refused.status, 503);
  assert.match((refused as { body: string }).body, /Edge did not start from msedge\.exe: ENOENT/);
});

test("a request with no token is refused, and a wrong one is told apart from a missing one", async (t) => {
  const { url } = await harness(t);
  assert.equal((await fetch(`${url}/health`)).status, 401);
  assert.equal((await fetch(`${url}/health`, { headers: { authorization: "Bearer nope" } })).status, 403);
  // Constant-time comparison throws on a length mismatch unless the lengths
  // are checked first; a wrong-length token must be a 403, not a 500.
  assert.equal((await fetch(`${url}/health`, { headers: { authorization: "Bearer x" } })).status, 403);
});

test("health reports the wire's version, whether Edge is up and why not, the stamp and whether the reader is up", async (t) => {
  const state = await harness(t);
  const { url } = state;
  const before = (await (await get(url, "/health")).json()) as DaemonHealth;
  assert.deepEqual(before, {
    ok: true,
    protocol: PROTOCOL_VERSION,
    started: false,
    browser: { running: true },
    rig: ["windows: test", "nvda: test"],
  });
  state.edgeDown = "Edge did not start from msedge.exe: ENOENT";
  assert.deepEqual(((await (await get(url, "/health")).json()) as DaemonHealth).browser, { running: false, error: "Edge did not start from msedge.exe: ENOENT" });
  await post(url, "/reader/start");
  assert.equal(((await (await get(url, "/health")).json()) as { started: boolean }).started, true);
  await post(url, "/reader/stop");
  assert.equal(((await (await get(url, "/health")).json()) as { started: boolean }).started, false);
});

test("a route's answer is the reader's own speech, and the bodies are checked", async (t) => {
  const { url, calls } = await harness(t);
  assert.deepEqual(await (await post(url, "/reader/perform", { command: "reportTitle" })).json(), { spoken: "Component Library - Microsoft Edge" });
  assert.deepEqual(await (await post(url, "/reader/press", { key: "Control+Home" })).json(), { spoken: "" });
  assert.deepEqual(await (await get(url, "/reader/log")).json(), { phrases: ["a", "b"] });
  assert.deepEqual(calls, ["perform reportTitle", "press Control+Home"]);

  const missing = await post(url, "/reader/perform", {});
  assert.equal(missing.status, 400);
  assert.match(((await missing.json()) as { error: string }).error, /`command` must be a non-empty string/);
  const notJson = await fetch(`${url}/reader/press`, { method: "POST", headers: auth, body: "{" });
  assert.equal(notJson.status, 400);
});

test("typing takes any text, a space included, and a pace that is a whole number of milliseconds", async (t) => {
  const { url, calls } = await harness(t);
  assert.deepEqual(await (await post(url, "/reader/type", { text: "ban", delay: 120 })).json(), { spoken: "b. a. n" });
  assert.equal((await post(url, "/reader/type", { text: " " })).status, 200);
  assert.deepEqual(calls, ['type "ban" 120', 'type " " 0']);

  for (const body of [{}, { text: "" }, { text: 7 }]) {
    const refused = await post(url, "/reader/type", body);
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /`text` must be a non-empty string/);
  }
  for (const delay of [-1, 1.5, "100", 10_001]) {
    const refused = await post(url, "/reader/type", { text: "ban", delay });
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /`delay` must be a whole number of milliseconds from 0 to 10000/);
  }
  assert.equal(calls.length, 2);
});

test("a reader failure is a 500 carrying the cause chain", async (t) => {
  const { url } = await harness(t);
  const response = await post(url, "/reader/perform", { command: "nope" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: ["unknown NVDA keyboard command: nope", "from guidepup"] });
});

test("start and stop answer with the desktop's lines", async (t) => {
  const { url, calls } = await harness(t);
  assert.deepEqual(await (await post(url, "/reader/start")).json(), { ok: true, lines: [] });
  assert.deepEqual(await (await post(url, "/reader/start")).json(), { ok: true, lines: ["NVDA was still up: stopped it first"] });
  assert.deepEqual(await (await post(url, "/reader/stop")).json(), { ok: true, lines: ["abandoned capture window: closed, and what it heard discarded"] });
  assert.deepEqual(calls, ["start", "start", "stop"]);
});

test("calls on the one reader run one after another, in the order they arrived", async (t) => {
  const state = await harness(t);
  const first = post(state.url, "/reader/next");
  while (!state.release) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = post(state.url, "/reader/perform", { command: "reportTitle" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The second request has arrived but must not have reached the reader.
  assert.deepEqual(state.calls, ["next started"]);
  state.release();
  await first;
  await second;
  assert.deepEqual(state.calls, ["next started", "next finished", "perform reportTitle"]);
});

test("the capture window is two routes, and the guard route runs the guards", async (t) => {
  const { url, calls } = await harness(t);
  assert.deepEqual(await (await post(url, "/reader/capture/begin")).json(), { ok: true });
  assert.deepEqual(await (await post(url, "/reader/capture/end")).json(), { spoken: "1 row selected" });
  assert.deepEqual(calls, ["capture begin", "capture end"]);

  const entry = (await (await post(url, "/reader/enter", { pageTitle: "Component Library" })).json()) as { ok: boolean; lines: string[]; error: string[] };
  // The fake's probes are silent and its focus report never says "document",
  // so the guards fail; what matters here is that they ran and reported, and
  // that a failed proof is a 200 carrying what was recorded and the reason.
  assert.equal(entry.ok, false);
  assert.match(entry.lines[0] ?? "", /^activate browser \(attempt 1\)/);
  assert.match(entry.error[0] ?? "", /^FOCUS GUARD FAILED/);
  assert.ok(calls.includes("activate"));

  const bad = await post(url, "/reader/enter", { pageTitle: "x", modeProbes: "moveToNextTable" });
  assert.equal(bad.status, 400);
});

test("an unknown route is a 404 that says what was asked for", async (t) => {
  const { url } = await harness(t);
  const response = await get(url, "/nope");
  assert.equal(response.status, 404);
  assert.match(((await response.json()) as { error: string }).error, /GET \/nope/);
});

/* ------------------------------------------------------------------- token */

test("a token that was set is used as it stands", () => {
  assert.deepEqual(resolveToken({ token: "given", interactive: true }), { token: "given", generated: false });
  assert.deepEqual(resolveToken({ token: "given", interactive: false }), { token: "given", generated: false });
});

test("started by hand with no token, one is generated and flagged for printing", () => {
  const first = resolveToken({ interactive: true });
  const second = resolveToken({ interactive: true });
  assert.equal(first.generated, true);
  assert.ok(first.token.length >= 32);
  assert.notEqual(first.token, second.token, "each start should get its own token");
});

test("started with no terminal and no token, it refuses rather than generating", () => {
  assert.throws(() => resolveToken({ interactive: false }), /RIG_TOKEN is not set/);
  assert.throws(() => resolveToken({ token: "", interactive: false }), /will not start/);
});

test("a daemon cannot be created without a token", () => {
  assert.throws(() => createRigServer({ token: "", desktop: {} as NvdaDesktop, edge: {} as Edge }), /RIG_TOKEN/);
});
