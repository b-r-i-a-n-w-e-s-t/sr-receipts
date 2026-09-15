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
import { join } from "node:path";

const RIG = join(import.meta.dirname, "..");
const TSC = join(RIG, "node_modules", "typescript", "bin", "tsc");

/**
 * Compile one snippet against the rig's own types; return tsc's output.
 *
 * The throwaway project lives inside the rig rather than in the system temp
 * directory, so a relative import reaches `../lib` and Node's module resolution
 * walks up to the rig's own `node_modules` for `@types/node` and guidepup.
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
    execFileSync(process.execPath, [TSC, "-p", dir], { encoding: "utf8" });
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

test("a misspelled NVDA command does not compile, and tsc names the right one", () => {
  // This is the failure `validateSteps` was written for: nvda.perform(undefined)
  // is silent, and a silence in a transcript reads exactly like a real one.
  const output = check(scenario(`{ steps: [{ perform: "moveToNextTabel" }] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /moveToNextTable/, "tsc should name the command that was meant");
});

test("a misspelled matcher does not compile", () => {
  // `contains` is the natural slip for `includes`.
  const output = check(
    scenario(`{ steps: [{ press: "Tab", expect: { contains: "table" } }] }`),
  );
  assert.match(output, /error TS\d+/);
  assert.match(output, /contains/);
});

test("a misspelled mode probe does not compile", () => {
  const output = check(scenario(`{ modeProbes: ["moveToNextTabel"], steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
});

test("a window size missing a dimension does not compile", () => {
  const output = check(scenario(`{ window: { width: 1120 }, steps: ["press:Tab"] }`));
  assert.match(output, /error TS\d+/);
  assert.match(output, /height/);
});

test("a bare step spec is checked too, not just the object form", () => {
  assert.equal(check(scenario(`{ steps: ["perform:reportTitle"] }`)), "");
  assert.match(check(scenario(`{ steps: ["perform:reportTitel"] }`)), /error TS\d+/);
});

test("a check with no bound still compiles, because only the runtime knows", () => {
  // Deliberate. `equals`, `atLeast` and `atMost` are each optional, and
  // expressing "at least one of these" in the type system would cost more in
  // readability than it returns. `validateCheck` covers it, and
  // test/expect.test.ts asserts that it does.
  assert.equal(
    check(scenario(`{ steps: ["press:Tab"], checks: [{ name: "n", matches: "x" }] }`)),
    "",
  );
});
