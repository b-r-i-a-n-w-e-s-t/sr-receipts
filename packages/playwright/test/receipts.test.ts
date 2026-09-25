/**
 * What the fixture does around a run, without Playwright or a rig.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { Receipt, Scenario } from "@sr-receipts/host";

import { assertReader, findings, resolveTarget, stepCount, timeoutFor } from "../src/receipts.ts";

const scenario: Scenario = {
  reader: "nvda",
  name: "s",
  steps: [
    "perform:reportTitle",
    ["enter", "press:ArrowDown"],
    { label: "move", perform: "moveToNextColumn", repeat: 3 },
    { label: "expand", press: "Enter", repeat: 2, settle: 1500 },
  ],
};

test("stepCount counts each repeat", () => {
  assert.equal(stepCount(scenario), 7);
});

test("timeoutFor is one open, a budget per step, and every settle", () => {
  assert.equal(timeoutFor(scenario, { open: 90_000, step: 10_000 }), 90_000 + 7 * 10_000 + 2 * 1500);
});

test("resolveTarget joins a path to baseURL and passes a URL through", () => {
  assert.equal(resolveTarget("/demo/96", "http://192.168.64.1:5176"), "http://192.168.64.1:5176/demo/96");
  assert.equal(resolveTarget("https://example.test/x", "http://192.168.64.1:5176"), "https://example.test/x");
  assert.throws(() => resolveTarget("/demo/96", undefined), /no receipts baseURL/);
});

test("assertReader refuses a scenario written for the other reader", () => {
  assert.doesNotThrow(() => assertReader(scenario, "nvda"));
  assert.throws(() => assertReader(scenario, "voiceover"), /written for nvda, and this project runs voiceover/);
});

test("findings lists every failed expectation and check under the reasons", () => {
  const receipt = {
    scenario: "s",
    target: "http://host/page",
    reasons: ["1 step expectation(s) failed", "1 check(s) failed"],
    failedExpectations: [{ label: "type a", spec: "press:a", failures: ["expected to match /a/i, heard x"] }],
    checks: [
      { name: "held", pattern: "p", count: 1, ok: true, failures: [], matchedLabels: [] },
      { name: "read once", pattern: "p", count: 2, ok: false, failures: ["expected at most 1, found 2"], matchedLabels: [] },
    ],
  } as unknown as Receipt;
  assert.equal(
    findings(receipt),
    [
      "FAIL: s on http://host/page",
      "  1 step expectation(s) failed",
      "  1 check(s) failed",
      '  - step "type a" (press:a): expected to match /a/i, heard x',
      '  - check "read once": expected at most 1, found 2',
    ].join("\n"),
  );
});
