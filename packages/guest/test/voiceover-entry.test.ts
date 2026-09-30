/**
 * VoiceOver's Entry, against fake steps: that the browser is activated,
 * the Item Chooser walked, both loops bounded, the marker put in and taken
 * out whatever happens, and arrival proved by the first item.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { EntryPage } from "@sr-receipts/host";

import { CHOOSER_ATTEMPTS, SEARCH_ATTEMPTS, enterWebContent, type EntrySteps, type ItemChooser } from "../voiceover/entry.ts";

interface Fake extends EntrySteps {
  calls: string[];
}

function fakeSteps(overrides: Partial<ItemChooser> = {}): Fake {
  const calls: string[] = [];
  return {
    calls,
    activate: async (name) => void calls.push(`activate ${name}`),
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

const enter = (steps: EntrySteps, target: EntryPage, lines: string[]) =>
  enterWebContent(steps, target, { applicationName: "Playwright" }, (...more) => void lines.push(...more));

test("entering web content activates the browser, walks the Item Chooser, and proves arrival by the first item", async () => {
  const steps = fakeSteps();
  const lines: string[] = [];
  const target = page();
  assert.equal(await enter(steps, target, lines), "Skip to main content link");
  assert.deepEqual(steps.calls, ["activate Playwright", "key Control", "open", "type w", "choose", "first item"]);
  // The marker went in and came out again.
  assert.equal(target.evaluated, 2);
  assert.deepEqual(lines, [
    "open item chooser (attempt 1): On item Web Content",
    "item chooser search (round 1): web content",
    '### focus guard: VoiceOver cursor in the web content, on "Skip to main content link"',
  ]);
});

test("an Item Chooser that never opens fails after a bounded number of attempts, quoting VoiceOver, and the marker comes out", async () => {
  const steps = fakeSteps({
    async open() {
      steps.calls.push("open");
      return "toolbar";
    },
  });
  const lines: string[] = [];
  const target = page();
  await assert.rejects(enter(steps, target, lines), /Item Chooser did not open in 10 attempts; VoiceOver last said "toolbar"/);
  assert.equal(steps.calls.filter((call) => call === "open").length, CHOOSER_ATTEMPTS);
  assert.equal(lines.length, CHOOSER_ATTEMPTS);
  assert.equal(target.evaluated, 2);
});

test("a search that never finds Web Content backspaces between rounds and gives up after a bounded number", async () => {
  const steps = fakeSteps({
    async type(character) {
      steps.calls.push(`type ${character}`);
      return "";
    },
  });
  const lines: string[] = [];
  await assert.rejects(enter(steps, page(), lines), /no Web Content entry after 5 attempts; VoiceOver last said ""/);
  assert.equal(steps.calls.filter((call) => call === "key Backspace").length, SEARCH_ATTEMPTS);
  assert.equal(steps.calls.filter((call) => call.startsWith("type ")).length, SEARCH_ATTEMPTS * "web content".length);
  assert.equal(lines.filter((line) => line.startsWith("item chooser search")).length, SEARCH_ATTEMPTS);
  assert.match(lines.at(-1) ?? "", /\(silence\)$/);
});

test("arriving on an item with no text is not arrival", async () => {
  const steps = fakeSteps({ firstItem: async () => "" });
  await assert.rejects(enter(steps, page(), []), /first item has no text/);
});
