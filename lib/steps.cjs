/**
 * Running a sequence of steps and recording what NVDA said to each one.
 *
 * A step is `[label, action]`, where `action` is either a string spec or a
 * function. The string form — `"perform:<keyboardCommand>"` or `"press:<key>"` —
 * is what the probe reads out of JSON, and is the form Phase 2 will move the
 * runner onto so a consuming repo can author scenarios as data without forking
 * the harness. The function form is the escape hatch for anything a spec cannot
 * express.
 *
 * `perform` exists because NVDA's own commands need the NVDA modifier, which
 * `press()` cannot express: its only modifiers are Shift, Control and Alt.
 */

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
 * Run every step, appending `### label` / what was heard to `lines`.
 *
 * A step that throws is recorded and the sequence continues: one unsupported
 * command should not discard the fifty announcements either side of it.
 */
async function runSteps(nvda, speech, steps, { lines = [], log } = {}) {
  for (const [label, spec] of steps) {
    const shown = typeof spec === "string" ? `${label} [${spec}]` : label;
    try {
      const action = toAction(nvda, spec);
      await speech.discard();
      await action();
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

module.exports = { toAction, runSteps };
