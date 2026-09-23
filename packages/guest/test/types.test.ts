/**
 * Proof that the types do the job the TypeScript conversion was for.
 *
 * Every other test checks a runtime validator. These check that the mistakes
 * those validators exist to catch are now *unwritable* by a TypeScript author —
 * which is the whole argument for the conversion. Without this file, a future
 * edit could widen `NvdaCommand` to `string` and every other test would still
 * pass.
 *
 * Each case is compiled in a throwaway project, and the assertion is on what
 * tsc reports. Slower than the rest of the suite, because it starts a compiler
 * per case; there are deliberately few of them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const RIG = join(import.meta.dirname, "..");
// Resolved rather than joined: npm workspaces install typescript at the
// workspace root. Its exports map hides `bin/tsc`, so the package root is
// resolved and the binary found beside it.
const TSC = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");

/**
 * Compile one snippet against the rig's own types; return tsc's output.
 *
 * The throwaway project lives inside the rig rather than in the system temp
 * directory, so a relative import reaches `../lib` and Node's module resolution
 * walks up to the workspace's `node_modules` for `@types/node` and guidepup.
 */
function check(source: string): string {
  const dir = mkdtempSync(join(RIG, ".type-case-"));
  try {
    writeFileSync(join(dir, "case.ts"), source, "utf8");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          types: ["node"],
          strict: true,
          noEmit: true,
          erasableSyntaxOnly: true,
          verbatimModuleSyntax: true,
          allowImportingTsExtensions: true,
          skipLibCheck: true,
        },
        include: ["case.ts"],
      }),
      "utf8",
    );
    // TypeScript 7 may color diagnostics even when stdout is captured. Keep
    // these assertions about the diagnostic text, not terminal capabilities.
    execFileSync(process.execPath, [TSC, "-p", dir, "--pretty", "false"], { encoding: "utf8" });
    return "";
  } catch (error) {
    // tsc exits non-zero on type errors and reports them on stdout.
    return (error as { stdout?: string }).stdout ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scenario = (body: string): string => `
import type { Scenario } from "../lib/types.ts";
const s: Scenario = ${body};
void s;
`;

test("a correct scenario compiles", () => {
  assert.equal(
    check(
      scenario(`{
        reader: "nvda",
        name: "ok",
        modeProbes: ["moveToNextTable"],
        window: { width: 1120, height: 1000 },
        steps: [
          { label: "title", perform: "reportTitle" },
          { label: "down", press: "ArrowDown", repeat: 3, settle: 500 },
          { label: "framing", perform: "moveToNextTable", expect: { matches: "table" } },
          ["tuple", "press:Tab"],
          "perform:reportTitle",
        ],
        checks: [{ name: "once", matches: "Additional Details", atMost: 1 }],
      }`),
    ),
    "",
  );
});

test("a typed scenario can be sent to a daemon as it stands", () => {
  // The guest's types narrow the host's structural Scenario, so anything that
  // compiles against them is already a valid request body.
  assert.equal(
    check(`
import type { Scenario } from "../lib/types.ts";
import type { RunRequest } from "@sr-receipts/host";
const nvda: Scenario = {
  reader: "nvda",
  modeProbes: ["moveToNextTable"],
  steps: [{ perform: "reportTitle", expect: { matches: "x" } }, ["tuple", "press:Tab"], "perform:reportTitle"],
  checks: [{ name: "n", matches: "x", equals: 1 }],
};
const voiceOver: Scenario = { reader: "voiceover", steps: ["perform:findNextTable"] };
const requests: RunRequest[] = [{ target: "a.html", scenario: nvda }, { target: "a.html", scenario: voiceOver }];
void requests;
`),
    "",
  );
});

test("a RegExp pattern does not compile, since it cannot cross the wire", () => {
  const output = check(scenario(`{ reader: "nvda", steps: [{ press: "Tab", expect: { matches: /x/i } }] }`));
  assert.match(output, /error TS\d+/);
});

test("a misspelled NVDA command does not compile, and tsc names the right one", () => {
  // This is the failure `validateSteps` was written for: nvda.perform(undefined)
  // is silent, and a silence in a transcript reads exactly like a real one.
  const output = check(scenario(`{ reader: "nvda", steps: [{ perform: "moveToNextTabel" }] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /moveToNextTable/, "tsc should name the command that was meant");
});

test("a scenario that does not name its reader does not compile", () => {
  const output = check(scenario(`{ steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /reader/);
});

test("a VoiceOver scenario is checked against VoiceOver's commands, not NVDA's", () => {
  assert.equal(
    check(scenario(`{ reader: "voiceover", steps: ["perform:findNextTable", { perform: "interactWithItem" }] }`)),
    "",
  );
  // `moveToNextTable` is a real command, but it is NVDA's. The two readers
  // share 17 names in all, so only the scenario's reader can say which is meant.
  assert.match(check(scenario(`{ reader: "voiceover", steps: ["perform:moveToNextTable"] }`)), /error TS\d+/);
  assert.match(check(scenario(`{ reader: "voiceover", steps: [{ perform: "moveToNextTable" }] }`)), /error TS\d+/);
  assert.match(check(scenario(`{ reader: "nvda", steps: ["perform:findNextTable"] }`)), /error TS\d+/);
});

test("mode probes do not compile on a VoiceOver scenario", () => {
  const output = check(scenario(`{ reader: "voiceover", modeProbes: ["findNextTable"], steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /modeProbes/);
});

test("a misspelled matcher does not compile", () => {
  // `contains` is the natural slip for `includes`.
  const output = check(
    scenario(`{ reader: "nvda", steps: [{ press: "Tab", expect: { contains: "table" } }] }`),
  );
  assert.match(output, /error TS\d+/);
  assert.match(output, /contains/);
});

test("a misspelled mode probe does not compile", () => {
  const output = check(scenario(`{ reader: "nvda", modeProbes: ["moveToNextTabel"], steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
});

test("a window size missing a dimension does not compile", () => {
  const output = check(scenario(`{ reader: "nvda", window: { width: 1120 }, steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /height/);
});

test("a bare step spec is checked too, not just the object form", () => {
  assert.equal(check(scenario(`{ reader: "nvda", steps: ["perform:reportTitle"] }`)), "");
  assert.match(check(scenario(`{ reader: "nvda", steps: ["perform:reportTitel"] }`)), /error TS\d+/);
});

test("a check with no bound still compiles, because only the runtime knows", () => {
  // Deliberate. `equals`, `atLeast` and `atMost` are each optional, and
  // expressing "at least one of these" in the type system would cost more in
  // readability than it returns. `validateCheck` covers it, and
  // test/expect.test.ts asserts that it does.
  assert.equal(
    check(scenario(`{ reader: "nvda", steps: ["press:Tab"], checks: [{ name: "n", matches: "x" }] }`)),
    "",
  );
});
