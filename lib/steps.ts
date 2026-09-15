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
import { delay } from "./system.ts";
import type { SpeechLog } from "./speech.ts";
import type {
  AuthoredStep,
  CompiledStep,
  NvdaCommand,
  NvdaDriver,
  StepAction,
  StepResult,
  StepSpec,
} from "./types.ts";

/** Tuples and bare specs in; `{ label, spec }` out. */
export function normalize(step: AuthoredStep | CompiledStep): CompiledStep {
  if (Array.isArray(step)) {
    const [label, spec] = step as readonly [string, StepSpec];
    return { label, spec };
  }
  if (typeof step === "string") return { label: step, spec: step };
  return step as CompiledStep;
}

/** Turn a `"perform:x"` / `"press:x"` spec into a thunk. Throws on nonsense. */
export function toAction(nvda: NvdaDriver, spec: StepSpec | StepAction): StepAction {
  if (typeof spec === "function") return spec;

  const match = /^(perform|press):(.+)$/.exec(spec);
  if (!match) {
    throw new Error(
      `bad step spec ${JSON.stringify(spec)}: expected "perform:<command>" or "press:<key>"`,
    );
  }
  const kind = match[1];
  const name = match[2] as string;

  if (kind === "press") return () => nvda.press(name);

  const command = nvda.keyboardCommands[name as NvdaCommand];
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
 * a silence in a transcript is indistinguishable from a real one. TypeScript
 * now rejects a literal typo at compile time, but a scenario can still arrive
 * as JSON, so this stays: catching it here means a typo costs a second, not a
 * three-minute run on the guest desktop followed by a puzzling read.
 */
export function validateSteps(
  nvda: NvdaDriver,
  steps: readonly (AuthoredStep | CompiledStep)[],
): void {
  const problems: string[] = [];
  steps.forEach((step, i) => {
    const { label, spec } = normalize(step);
    try {
      toAction(nvda, spec);
    } catch (error) {
      problems.push(`step ${i + 1} (${label}): ${(error as Error).message}`);
    }
  });
  if (problems.length) {
    throw new Error(`scenario has unrunnable steps:\n  ${problems.join("\n  ")}`);
  }
}

export interface RunStepsOptions {
  log?: (line: string) => void;
}

/**
 * Run every step and return what was heard, as data.
 *
 * A step that throws is recorded and the sequence continues: one unsupported
 * command should not discard the fifty announcements either side of it. Its
 * `heard` is the error text, so a downstream expectation on that step fails
 * rather than silently passing on an empty string.
 */
export async function runSteps(
  nvda: NvdaDriver,
  speech: SpeechLog,
  steps: readonly CompiledStep[],
  { log }: RunStepsOptions = {},
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of steps) {
    const { label, spec, settle, expect, snapshot } = step;
    const shown = typeof spec === "string" ? `${label} [${spec}]` : label;
    try {
      const action = toAction(nvda, spec);
      await speech.discard();
      await action();
      // Only for a step whose effect is not instant. NVDA has usually already
      // answered by the time `perform` resolves.
      if (settle) await delay(settle);
      const heard = await speech.heard();
      results.push({
        label,
        spec,
        heard,
        ...(expect !== undefined && { expect }),
        ...(snapshot !== undefined && { snapshot }),
      });
      log?.(`${shown} :: ${heard.replace(/\n/g, " / ")}`);
    } catch (error) {
      const message = (error as Error)?.message;
      results.push({
        label,
        spec,
        heard: `ERROR ${message}`,
        error: message,
        ...(expect !== undefined && { expect }),
        ...(snapshot !== undefined && { snapshot }),
      });
      log?.(`${shown} :: ERROR ${message}`);
    }
  }
  return results;
}
