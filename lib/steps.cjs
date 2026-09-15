/**
 * Running a sequence of steps and recording what NVDA said to each one.
 *
 * A step reaching here is `{ label, spec, settle? }`, which is what
 * `compileScenario` produces, or the `[label, spec]` tuple `probe.json` is
 * written in. `spec` is `"perform:<keyboardCommand>"` or `"press:<key>"`, or a
 * function for anything a spec cannot express.
 *
 * `perform` exists because NVDA's own commands need the NVDA modifier, which
 * `press()` cannot express: its only modifiers are Shift, Control and Alt.
 */
const { delay } = require("./system.cjs");

/** Tuples and bare specs in; `{ label, spec, settle }` out. */
function normalize(step) {
  if (Array.isArray(step)) return { label: step[0], spec: step[1] };
  if (typeof step === "string") return { label: step, spec: step };
  return step;
}

/** Turn a `"perform:x"` / `"press:x"` spec into a thunk. Throws on nonsense. */
function toAction(nvda, spec) {
  if (typeof spec === "function") return spec;

  const match = /^(perform|press):(.+)$/.exec(spec);
  if (!match) {
    throw new Error(
      `bad step spec ${JSON.stringify(spec)}: expected "perform:<command>" or "press:<key>"`,
    );
  }
  const [, kind, name] = match;

  if (kind === "press") return () => nvda.press(name);

  const command = nvda.keyboardCommands[name];
  if (!command) {
    throw new Error(
      `unknown NVDA keyboard command ${JSON.stringify(name)}; see nvda.keyboardCommands`,
    );
  }
  return () => nvda.perform(command);
}

/**
 * Resolve every step before the run starts.
 *
 * A misspelled command reaches `nvda.perform(undefined)`, which is silent — and
 * a silence in a transcript is indistinguishable from a real one. Catching it
 * here means a typo costs a second, not a three-minute run on the guest desktop
 * followed by a puzzling read.
 */
function validateSteps(nvda, steps) {
  const problems = [];
  steps.forEach((step, i) => {
    const { label, spec } = normalize(step);
    try {
      toAction(nvda, spec);
    } catch (error) {
      problems.push(`step ${i + 1} (${label}): ${error.message}`);
    }
  });
  if (problems.length) {
    throw new Error(`scenario has unrunnable steps:\n  ${problems.join("\n  ")}`);
  }
}

/**
 * Run every step, appending `### label` / what was heard to `lines`.
 *
 * A step that throws is recorded and the sequence continues: one unsupported
 * command should not discard the fifty announcements either side of it.
 */
async function runSteps(nvda, speech, steps, { lines = [], log } = {}) {
  for (const step of steps) {
    const { label, spec, settle } = normalize(step);
    const shown = typeof spec === "string" ? `${label} [${spec}]` : label;
    try {
      const action = toAction(nvda, spec);
      await speech.discard();
      await action();
      // Only for a step whose effect is not instant. NVDA has usually already
      // answered by the time `perform` resolves.
      if (settle) await delay(settle);
      const heard = await speech.heard();
      lines.push(`### ${shown}`, heard, "");
      log?.(`${shown} :: ${heard.replace(/\n/g, " / ")}`);
    } catch (error) {
      lines.push(`### ${shown}`, `ERROR ${error?.message}`, "");
      log?.(`${shown} :: ERROR ${error?.message}`);
    }
  }
  return lines;
}

module.exports = { normalize, toAction, validateSteps, runSteps };
