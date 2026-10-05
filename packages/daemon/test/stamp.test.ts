/**
 * The Environment Stamp, with PowerShell faked: every line is there whatever
 * Windows answered, because a stamp with a gap is better than a lost run.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { stamp } from "../src/lib/stamp.ts";

test("every line is collected, and a query that fails reads as unknown", async () => {
  const lines = await stamp(async (script) => {
    if (script.includes("UBR")) throw new Error("access denied");
    if (script.includes("DisplayVersion")) return "24H2";
    if (script.includes("CurrentBuild")) return "26100";
    return "153.0.4234.48";
  });
  assert.equal(lines.length, 6);
  assert.match(lines[0] ?? "", /^windows: 24H2 build 26100\.unknown /);
  assert.match(lines[1] ?? "", /^edge: 153\.0\.4234\.48 at .*msedge\.exe, driven by playwright-core \d+\.\d+\.\d+$/);
  assert.match(lines[3] ?? "", /^guidepup: \d+\.\d+\.\d+$/);
  assert.equal(lines[4], `node: ${process.version}`);
});
