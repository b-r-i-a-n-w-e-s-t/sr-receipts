/**
 * What the fixture decides before a reader starts, tested without Playwright
 * or a reader: which session a project gets, what VoiceOver is told to
 * activate, and what a missing guest says.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { applicationNameFor, createSession, environmentStamp, loadGuest } from "../src/fixture.ts";

test("VoiceOver activates the application Playwright launched, by browser or channel", () => {
  assert.equal(applicationNameFor("webkit", undefined), "Playwright");
  assert.equal(applicationNameFor("chromium", undefined), "Google Chrome for Testing");
  assert.equal(applicationNameFor("chromium", "chrome"), "Google Chrome");
  assert.equal(applicationNameFor("chromium", "msedge"), "Microsoft Edge");
  assert.equal(applicationNameFor("firefox", undefined), "Nightly");
});

test("an NVDA project gets a session over the wire and never loads the guest", async () => {
  const session = await createSession({ reader: "nvda", url: "http://127.0.0.1:1", token: "t" }, { browserName: "chromium", channel: "msedge" }, async () => {
    throw new Error("must not be loaded");
  });
  assert.equal(session.reader, "nvda");
});

test("a VoiceOver project loads the guest and passes the application name through", async () => {
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

test("a VoiceOver project without the guest installed says what to install", async () => {
  await assert.rejects(
    loadGuest(async () => {
      throw Object.assign(new Error("Cannot find package '@sr-receipts/guest'"), { code: "ERR_MODULE_NOT_FOUND" });
    }),
    /needs @sr-receipts\/guest installed beside @sr-receipts\/playwright/,
  );
  await assert.rejects(
    loadGuest(async () => {
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
