/**
 * Scenarios: what to ask a target, authored as data rather than welded into the
 * harness.
 *
 * Until now the sequence lived inside `runner.cjs`, so a repo that wanted to ask
 * a different question had to fork the runner — and with it the guards, the
 * timings and the lifecycle it had no interest in changing. A scenario is now a
 * file: this repo ships some under `scenarios/`, and a consuming repo can point
 * the rig at its own.
 *
 * ## Shape
 *
 *   {
 *     name: "column-list-table",
 *     description: "one line on what question this answers",
 *     modeProbes: ["moveToNextTable"],   // optional; see lib/guard.cjs
 *     steps: [ ... ]
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
 * The object form is the one that earns its keep, because it takes `repeat` and
 * `settle`:
 *
 *   { label: "ctrl+alt+right, move", perform: "moveToNextColumn", repeat: 11 }
 *   { label: "expand row 1", press: "Enter", settle: 1500 }
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
 */
const { pathToFileURL } = require("node:url");
const { readFileSync } = require("node:fs");
const { extname, isAbsolute, join, resolve } = require("node:path");

const SCENARIOS = join(__dirname, "..", "scenarios");

/**
 * One compiled step. `settle` is omitted rather than set to undefined, so two
 * steps that mean the same thing compare equal — which matters once Phase 3
 * starts diffing compiled scenarios.
 */
const makeStep = (label, spec, settle) =>
  settle === undefined ? { label, spec } : { label, spec, settle };

/** One authored step to one or more `{ label, spec, settle? }`. */
function compileStep(step, index) {
  const where = `step ${index + 1}`;

  if (typeof step === "string") return [makeStep(step, step)];

  if (Array.isArray(step)) {
    const [label, spec] = step;
    if (typeof label !== "string" || typeof spec !== "string") {
      throw new Error(`${where}: a tuple step must be ["label", "perform:x"|"press:y"]`);
    }
    return [makeStep(label, spec)];
  }

  if (typeof step !== "object" || step === null) {
    throw new Error(`${where}: expected a string, a tuple or an object, got ${typeof step}`);
  }

  const { label, perform, press, repeat = 1, settle } = step;
  if ((perform === undefined) === (press === undefined)) {
    throw new Error(`${where}: an object step needs exactly one of "perform" or "press"`);
  }
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`${where}: "repeat" must be a positive integer, got ${repeat}`);
  }
  if (settle !== undefined && (!Number.isFinite(settle) || settle < 0)) {
    throw new Error(`${where}: "settle" must be a non-negative number of ms, got ${settle}`);
  }

  const spec = perform !== undefined ? `perform:${perform}` : `press:${press}`;
  const base = label ?? spec;

  if (repeat === 1) return [makeStep(base, spec, settle)];

  return Array.from({ length: repeat }, (_, i) => {
    const n = i + 1;
    const numbered = base.includes("{n}")
      ? base.replaceAll("{n}", String(n))
      : `${base} ${n}`;
    return makeStep(numbered, spec, settle);
  });
}

/**
 * Validate and flatten a scenario. Structural only — it does not need NVDA, so
 * a malformed scenario in a consuming repo is caught by `npm test` rather than
 * three minutes into a run on the guest desktop.
 */
function compileScenario(scenario, source = "scenario") {
  if (typeof scenario !== "object" || scenario === null) {
    throw new Error(`${source}: expected an object, got ${typeof scenario}`);
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error(`${source}: needs a non-empty "steps" array`);
  }
  if (scenario.modeProbes !== undefined && !Array.isArray(scenario.modeProbes)) {
    throw new Error(`${source}: "modeProbes" must be an array of command names`);
  }

  const steps = scenario.steps.flatMap((step, i) => {
    try {
      return compileStep(step, i);
    } catch (error) {
      throw new Error(`${source}: ${error.message}`);
    }
  });

  return {
    name: scenario.name ?? source,
    description: scenario.description ?? "",
    modeProbes: scenario.modeProbes,
    steps,
  };
}

/**
 * Load a scenario by name or path.
 *
 * A bare name resolves to `scenarios/<name>.cjs` in this repo. Anything with a
 * path separator or an extension is resolved against the current directory,
 * which is how a consuming repo points the rig at its own file:
 *
 *   node runner.cjs --scenario ./a11y/scenarios/data-table.mjs
 *
 * `.json` is read and parsed; everything else goes through dynamic `import`,
 * which handles `.cjs`, `.js` and `.mjs` alike and hands back `default` when the
 * file has one.
 */
async function loadScenario(ref) {
  const looksLikePath = /[\\/]/.test(ref) || extname(ref) !== "";
  const path = looksLikePath
    ? isAbsolute(ref)
      ? ref
      : resolve(process.cwd(), ref)
    : join(SCENARIOS, `${ref}.cjs`);

  let loaded;
  try {
    if (extname(path) === ".json") {
      loaded = JSON.parse(readFileSync(path, "utf8"));
    } else {
      const module = await import(pathToFileURL(path).href);
      loaded = module.default ?? module;
    }
  } catch (error) {
    throw new Error(`could not load scenario ${JSON.stringify(ref)} from ${path}: ${error.message}`);
  }

  return compileScenario(loaded, ref);
}

module.exports = { SCENARIOS, compileStep, compileScenario, loadScenario };
