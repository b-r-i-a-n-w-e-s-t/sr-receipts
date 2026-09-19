/**
 * Scenarios: what to ask a target, authored as data rather than welded into the
 * harness.
 *
 * The sequence used to live inside the runner, so a repo that wanted to ask a
 * different question had to fork it — and with it the guards, the timings and
 * the lifecycle it had no interest in changing. A scenario is now a file: this
 * repo ships some under `scenarios/`, and a consuming repo can point the rig at
 * its own.
 *
 * The authoring format is described by the `Scenario` type in `lib/types.ts`,
 * which is where a reader should start: in TypeScript a misspelled command name
 * or matcher no longer compiles. Everything validated here is validated because
 * a scenario can also arrive as JSON, or from a repo that never ran tsc.
 *
 * ## Shape
 *
 *   {
 *     name: "column-list-table",
 *     description: "one line on what question this answers",
 *     modeProbes: ["moveToNextTable"],        // optional; see lib/guard.ts
 *     window: { width: 1120, height: 1000 },  // optional; see lib/firefox.ts
 *     focusCheckEvery: 3,                     // optional; see lib/session.ts
 *     steps: [ ... ],
 *     checks: [ ... ]                         // optional; see lib/expect.ts
 *   }
 *
 * ## Steps
 *
 * A step is written in whichever of these is clearest:
 *
 *   "perform:reportTitle"                       bare spec; the spec is the label
 *   ["title bar", "perform:reportTitle"]        tuple; the form probe.json uses
 *   { label, perform: "moveToNextColumn" }      object
 *   { label, press: "ArrowDown" }
 *
 * The object form is the one that earns its keep, because it takes `repeat`,
 * `settle`, `expect` and `snapshot`:
 *
 *   { label: "ctrl+alt+right, move", perform: "moveToNextColumn", repeat: 11 }
 *   { label: "expand row 1", press: "Enter", settle: 1500 }
 *   { label: "T table framing", perform: "moveToNextTable",
 *     expect: { matches: "table, with \\d+ rows" } }
 *   { label: "tab", press: "Tab", repeat: 8, snapshot: false }
 *
 * `repeat` expands to that many steps. The label is numbered: `{n}` is
 * substituted if present, otherwise the number is appended — so the two labels
 * above become `ctrl+alt+right, move 1` … `move 11`, and a label written as
 * `row +{n}` becomes `row +1` … `row +3`.
 *
 * `settle` waits after the keystroke before reading the speech log, for a step
 * whose effect is not instant — expanding a row, following a link, anything that
 * re-renders. Most steps do not need it; NVDA has already answered by the time
 * `perform` resolves.
 *
 * `expect` states what must be true of the announcement whatever the target —
 * exact wording belongs in a snapshot instead. `snapshot: false` records the
 * step but keeps it out of the snapshot.
 */
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCheck, validateExpectation } from "./expect.ts";
import type {
  AuthoredStep,
  AuthoredStepObject,
  Check,
  CompiledScenario,
  CompiledStep,
  Expectations,
  Scenario,
  StepSpec,
  WindowSize,
} from "./types.ts";

export const SCENARIOS = join(import.meta.dirname, "..", "scenarios");

/**
 * One compiled step. Optional fields are omitted rather than set to undefined,
 * so two steps that mean the same thing compare equal — which matters for
 * diffing compiled scenarios.
 */
const makeStep = (
  label: string,
  spec: StepSpec,
  extra: {
    settle?: number | undefined;
    expect?: Expectations | undefined;
    snapshot?: boolean | undefined;
  } = {},
): CompiledStep => {
  const step: CompiledStep = { label, spec };
  if (extra.settle !== undefined) step.settle = extra.settle;
  if (extra.expect !== undefined) step.expect = extra.expect;
  if (extra.snapshot !== undefined) step.snapshot = extra.snapshot;
  return step;
};

/** One authored step to one or more compiled steps. */
export function compileStep(step: AuthoredStep, index: number): CompiledStep[] {
  const where = `step ${index + 1}`;

  if (typeof step === "string") return [makeStep(step, step)];

  if (Array.isArray(step)) {
    const [label, spec] = step as readonly [unknown, unknown];
    if (typeof label !== "string" || typeof spec !== "string") {
      throw new Error(`${where}: a tuple step must be ["label", "perform:x"|"press:y"]`);
    }
    return [makeStep(label, spec as StepSpec)];
  }

  if (typeof step !== "object" || step === null) {
    throw new Error(`${where}: expected a string, a tuple or an object, got ${typeof step}`);
  }

  const { label, perform, press, repeat = 1, settle, expect, snapshot } =
    step as AuthoredStepObject;
  if ((perform === undefined) === (press === undefined)) {
    throw new Error(`${where}: an object step needs exactly one of "perform" or "press"`);
  }
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`${where}: "repeat" must be a positive integer, got ${repeat}`);
  }
  if (settle !== undefined && (!Number.isFinite(settle) || settle < 0)) {
    throw new Error(`${where}: "settle" must be a non-negative number of ms, got ${settle}`);
  }
  if (snapshot !== undefined && typeof snapshot !== "boolean") {
    throw new Error(`${where}: "snapshot" must be true or false, got ${typeof snapshot}`);
  }
  validateExpectation(expect, where);

  const spec = (perform !== undefined ? `perform:${perform}` : `press:${press}`) as StepSpec;
  const base = label ?? spec;
  const extra = { settle, expect, snapshot };

  if (repeat === 1) return [makeStep(base, spec, extra)];

  // An expectation applies to each expanded step in turn, which is what makes
  // `{ perform: "moveToNextColumn", repeat: 11, expect: { not: { silent: true } } }`
  // mean "none of these eleven moves may be silent".
  return Array.from({ length: repeat }, (_, i) => {
    const n = i + 1;
    const numbered = base.includes("{n}")
      ? base.replaceAll("{n}", String(n))
      : `${base} ${n}`;
    return makeStep(numbered, spec, extra);
  });
}

/**
 * A window size is two positive integers or nothing. Checked structurally here
 * so a typo costs a second on the host rather than a four-minute run that
 * silently measures the wrong width.
 */
export function validateWindow(window: unknown, source: string): void {
  if (window === undefined) return;
  if (typeof window !== "object" || window === null || Array.isArray(window)) {
    throw new Error(`${source}: "window" must be { width, height }`);
  }
  for (const key of ["width", "height"] as const) {
    const value = (window as Record<string, unknown>)[key];
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new Error(`${source}: "window.${key}" must be a positive integer, got ${value}`);
    }
  }
}

/**
 * Validate and flatten a scenario. Structural only — it does not need NVDA, so
 * a malformed scenario in a consuming repo is caught by `npm test` rather than
 * three minutes into a run on the guest desktop.
 */
export function compileScenario(scenario: unknown, source = "scenario"): CompiledScenario {
  if (typeof scenario !== "object" || scenario === null) {
    throw new Error(`${source}: expected an object, got ${typeof scenario}`);
  }
  const candidate = scenario as Scenario;

  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    throw new Error(`${source}: needs a non-empty "steps" array`);
  }
  if (candidate.modeProbes !== undefined && !Array.isArray(candidate.modeProbes)) {
    throw new Error(`${source}: "modeProbes" must be an array of command names`);
  }
  if (candidate.checks !== undefined && !Array.isArray(candidate.checks)) {
    throw new Error(`${source}: "checks" must be an array`);
  }
  validateWindow(candidate.window, source);
  if (
    candidate.focusCheckEvery !== undefined &&
    (!Number.isInteger(candidate.focusCheckEvery) || candidate.focusCheckEvery < 1)
  ) {
    throw new Error(
      `${source}: "focusCheckEvery" must be a positive integer, got ${candidate.focusCheckEvery}`,
    );
  }

  const steps = candidate.steps.flatMap((step, i) => {
    try {
      return compileStep(step, i);
    } catch (error) {
      throw new Error(`${source}: ${(error as Error).message}`);
    }
  });

  const checks: Check[] = candidate.checks ?? [];
  checks.forEach((check, i) => validateCheck(check, `${source}: check ${i + 1}`));

  const compiled: CompiledScenario = {
    name: candidate.name ?? source,
    description: candidate.description ?? "",
    steps,
    checks,
  };
  if (candidate.modeProbes !== undefined) compiled.modeProbes = candidate.modeProbes;
  if (candidate.window !== undefined) compiled.window = candidate.window as WindowSize;
  if (candidate.focusCheckEvery !== undefined) compiled.focusCheckEvery = candidate.focusCheckEvery;
  return compiled;
}

/**
 * Load a scenario by name or path.
 *
 * A bare name resolves to `scenarios/<name>.ts` in this repo. Anything with a
 * path separator or an extension is resolved against the current directory,
 * which is how a consuming repo points the rig at its own file:
 *
 *   node runner.ts --scenario ./a11y/scenarios/data-table.ts
 *
 * `.json` is read and parsed; everything else goes through dynamic `import`,
 * which handles `.ts`, `.mts`, `.mjs`, `.cjs` and `.js` alike — Node strips
 * types from an imported `.ts` the same way it does for an entry point — and
 * hands back `default` when the file has one.
 */
export async function loadScenario(ref: string): Promise<CompiledScenario> {
  const looksLikePath = /[\\/]/.test(ref) || extname(ref) !== "";
  const path = looksLikePath
    ? isAbsolute(ref)
      ? ref
      : resolve(process.cwd(), ref)
    : join(SCENARIOS, `${ref}.ts`);

  let loaded: unknown;
  try {
    if (extname(path) === ".json") {
      loaded = JSON.parse(readFileSync(path, "utf8"));
    } else {
      const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
      loaded = module.default ?? module;
    }
  } catch (error) {
    throw new Error(
      `could not load scenario ${JSON.stringify(ref)} from ${path}: ${(error as Error).message}`,
    );
  }

  return compileScenario(loaded, ref);
}
