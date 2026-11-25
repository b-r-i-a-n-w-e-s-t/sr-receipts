/**
 * The host's compatibility check against a stand-in daemon's `/health`: a
 * guest is refused when it speaks another wire protocol or serves its browser
 * from another Playwright minor, with the cause and the fix named, and an
 * unreachable daemon is named as one. The check against the real daemon is in
 * `@sr-receipts/daemon`'s wire test.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { checkGuestCompatibility } from "../src/client.ts";
import { PROTOCOL_VERSION } from "../src/protocol.ts";

/** A daemon whose `/health` answers with `health`, merged over a current one. */
async function guest(t: test.TestContext, health: Record<string, unknown> = {}): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, playwright: "1.63.0", started: false, browser: { port: 8766, path: "/t" }, rig: [], ...health }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("a guest on this host's protocol and Playwright minor passes, whatever the patch", async (t) => {
  const url = await guest(t);
  await checkGuestCompatibility({ url, token: "t" }, "1.63.0");
  await checkGuestCompatibility({ url, token: "t" }, "1.63.2");
});

test("a guest on another Playwright minor is refused with both versions and both fixes", async (t) => {
  const url = await guest(t);
  await assert.rejects(checkGuestCompatibility({ url, token: "t" }, "1.64.0"), (error: Error) => {
    assert.match(error.message, /served by Playwright 1\.63 and this run is Playwright 1\.64/);
    assert.match(error.message, /install @playwright\/test@1\.63 here, or bring the guest to a daemon built on Playwright 1\.64$/);
    return true;
  });
});

test("a guest on another wire protocol, or none, is refused for that before its Playwright is read", async (t) => {
  for (const protocol of [PROTOCOL_VERSION + 1, undefined]) {
    const url = await guest(t, { protocol, playwright: undefined });
    await assert.rejects(
      checkGuestCompatibility({ url, token: "t" }, "1.64.0"),
      new RegExp(`at ${url} speaks wire protocol ${protocol ?? "none"}, and this host speaks ${PROTOCOL_VERSION}; bring the older side up to date`),
    );
  }
});

test("a daemon that does not answer is named as unreachable", async () => {
  await assert.rejects(checkGuestCompatibility({ url: "http://127.0.0.1:1", token: "t" }, "1.63.0"), /the guest daemon at http:\/\/127\.0\.0\.1:1 is not reachable/);
});
