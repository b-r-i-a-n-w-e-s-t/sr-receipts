/**
 * VoiceOver's Entry, against a fake desktop: that the browser is activated,
 * the Item Chooser walked, both loops bounded, the marker put in and taken
 * out whatever happens, and arrival proved by the first item.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage } from "@sr-receipts/host";

import type { VoiceOverDesktop } from "../voiceover/desktop.ts";
import { CHOOSER_ATTEMPTS, SEARCH_ATTEMPTS, enterWebContent } from "../voiceover/entry.ts";

interface Fake extends VoiceOverDesktop {
  calls: string[];
}

function fakeDesktop(overrides: Partial<VoiceOverDesktop["chooser"]> = {}): Fake {
  const calls: string[] = [];
  const unused = () => Promise.reject(new Error("the entry must not send a command"));
  return {
    calls,
    start: unused,
    stop: unused,
    activate: async (name) => void calls.push(`activate ${name}`),
    perform: unused,
    press: unused,
    next: unused,
    previous: unused,
    capture: unused,
    spokenPhraseLog: unused,
    clearSpokenPhraseLog: unused,
    chooser: {
      key: async (name) => void calls.push(`key ${name}`),
      async open() {
        calls.push("open");
        return "On item Web Content";
      },
      async type(character) {
        calls.push(`type ${character}`);
        return "web content";
      },
      choose: async () => void calls.push("choose"),
      async firstItem() {
        calls.push("first item");
        return "Skip to main content link";
      },
      ...overrides,
    },
    environment: () => [],
  };
}

const page = (): EntryPage & { evaluated: number } => {
  const fake = {
    evaluated: 0,
    title: async () => "Component Library",
    bringToFront: async () => undefined,
    async evaluate() {
      fake.evaluated += 1;
      return undefined;
    },
  };
  return fake;
};

const enter = (desktop: VoiceOverDesktop, target: EntryPage, lines: string[]) =>
  enterWebContent(desktop, target, { applicationName: "Playwright" }, (...more) => void lines.push(...more));

test("entering web content activates the browser, walks the Item Chooser, and proves arrival by the first item", async () => {
  const desktop = fakeDesktop();
  const lines: string[] = [];
  const target = page();
  assert.equal(await enter(desktop, target, lines), "Skip to main content link");
  assert.deepEqual(desktop.calls, ["activate Playwright", "key Control", "open", "type w", "choose", "first item"]);
  // The marker went in and came out again.
  assert.equal(target.evaluated, 2);
  assert.deepEqual(lines, [
    "open item chooser (attempt 1): On item Web Content",
    "item chooser search (round 1): web content",
    '### focus guard: VoiceOver cursor in the web content, on "Skip to main content link"',
  ]);
});

test("an Item Chooser that never opens fails after a bounded number of attempts, quoting VoiceOver, and the marker comes out", async () => {
  const desktop = fakeDesktop({
    async open() {
      desktop.calls.push("open");
      return "toolbar";
    },
  });
  const lines: string[] = [];
  const target = page();
  await assert.rejects(enter(desktop, target, lines), /Item Chooser did not open in 10 attempts; VoiceOver last said "toolbar"/);
  assert.equal(desktop.calls.filter((call) => call === "open").length, CHOOSER_ATTEMPTS);
  assert.equal(lines.length, CHOOSER_ATTEMPTS);
  assert.equal(target.evaluated, 2);
});

test("a search that never finds Web Content backspaces between rounds and gives up after a bounded number", async () => {
  const desktop = fakeDesktop({
    async type(character) {
      desktop.calls.push(`type ${character}`);
      return "";
    },
  });
  const lines: string[] = [];
  await assert.rejects(enter(desktop, page(), lines), /no Web Content entry after 5 attempts; VoiceOver last said ""/);
  assert.equal(desktop.calls.filter((call) => call === "key Backspace").length, SEARCH_ATTEMPTS);
  assert.equal(desktop.calls.filter((call) => call.startsWith("type ")).length, SEARCH_ATTEMPTS * "web content".length);
  assert.equal(lines.filter((line) => line.startsWith("item chooser search")).length, SEARCH_ATTEMPTS);
  assert.match(lines.at(-1) ?? "", /\(silence\)$/);
});

test("arriving on an item with no text is not arrival", async () => {
  const desktop = fakeDesktop({ firstItem: async () => "" });
  await assert.rejects(enter(desktop, page(), []), /first item has no text/);
});
