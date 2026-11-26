/**
 * The host's compatibility check against a stand-in daemon's `/health`: a
 * guest is refused when it speaks another wire protocol or its Edge is not
 * running, with the cause and the fix named, and an unreachable daemon is
 * named as one. Also where a test's browser connects, derived from the
 * daemon's URL. The check against the real daemon is in
 * `@sr-receipts/daemon`'s wire test.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { browserEndpoint, checkGuestCompatibility } from "../src/client.ts";
import { PROTOCOL_VERSION } from "../src/protocol.ts";

/** A daemon whose `/health` answers with `health`, merged over a current one. */
async function guest(t: test.TestContext, health: Record<string, unknown> = {}): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, started: false, browser: { running: true }, rig: [], ...health }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("a guest on this host's protocol with its Edge running passes", async (t) => {
  const url = await guest(t);
  await checkGuestCompatibility({ url, token: "t" });
});

test("a guest whose Edge is not running is refused with why and what to do", async (t) => {
  const url = await guest(t, { browser: { running: false, error: "msedge.exe not found" } });
  await assert.rejects(checkGuestCompatibility({ url, token: "t" }), (error: Error) => {
    assert.match(error.message, /the guest's Edge is not running: msedge\.exe not found/);
    assert.match(error.message, /restart the nvda-daemon task on the guest/);
    return true;
  });
});

test("a guest on another wire protocol, or none, is refused for that before its Edge is read", async (t) => {
  for (const protocol of [PROTOCOL_VERSION + 1, undefined]) {
    const url = await guest(t, { protocol, browser: undefined });
    await assert.rejects(
      checkGuestCompatibility({ url, token: "t" }),
      new RegExp(`at ${url} speaks wire protocol ${protocol ?? "none"}, and this host speaks ${PROTOCOL_VERSION}; bring the older side up to date`),
    );
  }
});

test("a daemon that does not answer is named as unreachable", async () => {
  await assert.rejects(checkGuestCompatibility({ url: "http://127.0.0.1:1", token: "t" }), /the guest daemon at http:\/\/127\.0\.0\.1:1 is not reachable/);
});

test("a test's browser connects to the daemon's /browser, over ws or wss as the daemon is reached, with the token as a header", () => {
  assert.deepEqual(browserEndpoint({ url: "http://192.168.64.2:8765", token: "s3cret" }), {
    url: "ws://192.168.64.2:8765/browser",
    headers: { authorization: "Bearer s3cret" },
  });
  assert.equal(browserEndpoint({ url: "https://guest.example/rig/", token: "t" }).url, "wss://guest.example/rig/browser");
});
