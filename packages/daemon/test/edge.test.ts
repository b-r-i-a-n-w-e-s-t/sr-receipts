/**
 * The guest's Edge, owned by the daemon, tested with Playwright's own
 * Chromium standing in for `msedge.exe`: both are Chromium, and both write
 * the same `DevToolsActivePort`. What is proved is what the daemon relies
 * on: that a started browser's DevTools endpoint is found on loopback, that
 * one which has gone is started again when next asked for, and that one
 * which cannot start says why. Edge's window under NVDA is the Smoke's.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

import { createEdge, type Edge } from "../src/lib/edge.ts";

/** Headless, so a test run puts no window on this machine. */
function standIn(t: test.TestContext, executable = chromium.executablePath()): Edge {
  const edge = createEdge({ executable, profile: mkdtempSync(join(tmpdir(), "sr-edge-")), args: ["--headless"] });
  t.after(() => edge.close());
  return edge;
}

/** Asks the browser behind a DevTools endpoint to close, as a crash would leave it: gone. */
async function closeBrowser(endpoint: string): Promise<void> {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const closed = new Promise((resolve) => (socket.onclose = resolve));
  socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  await closed;
}

const alive = async (endpoint: string): Promise<boolean> =>
  fetch(`http://${new URL(endpoint).host}/json/version`).then(
    (response) => response.ok,
    () => false,
  );

test("a started Edge's DevTools endpoint is a browser WebSocket on loopback, and asking again answers the same", async (t) => {
  const edge = standIn(t);
  const endpoint = await edge.endpoint();
  assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+$/);
  assert.ok(await alive(endpoint));
  assert.equal(await edge.endpoint(), endpoint);
  assert.deepEqual(await edge.health(), { running: true });
});

test("two callers asking at once get one Edge", async (t) => {
  const edge = standIn(t);
  const [a, b] = await Promise.all([edge.endpoint(), edge.endpoint()]);
  assert.equal(a, b);
});

test("an Edge that has gone is started again by the next caller", async (t) => {
  const edge = standIn(t);
  const first = await edge.endpoint();
  await closeBrowser(first);
  const second = await edge.endpoint();
  assert.notEqual(second, first);
  assert.ok(await alive(second));
});

test("an Edge that cannot start says why, and its health says so too", async (t) => {
  const edge = standIn(t, "/nonexistent/msedge.exe");
  await assert.rejects(edge.endpoint(), /Edge did not start from \/nonexistent\/msedge\.exe: .*ENOENT/);
  const health = await edge.health();
  assert.equal(health.running, false);
  assert.match(health.error ?? "", /Edge did not start from \/nonexistent\/msedge\.exe/);
});
