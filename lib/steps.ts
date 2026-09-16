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
  FocusWatch,
  NvdaCommand,
  NvdaDriver,
  RunStepsResult,
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
  log?: ((line: string) => void) | undefined;
  /**
   * The same announcements as `log`, unformatted.
   *
   * `log` flattens a step to one printable line, which is all `smoke.ts` and
   * `probe.ts` ever wanted. A run being watched over a wire wants the label and
   * the announcement apart, and wants the newlines inside a multi-phrase
   * announcement left alone, so it gets the `StepResult` itself.
   */
  onStep?: ((step: StepResult, index: number) => void) | undefined;
  /**
   * Re-check every few steps that the keystrokes are still reaching the target.
   * Omit it and the sequence runs blind, which is what it did before this
   * existed — see `FocusWatch` for what that cost.
   */
  watch?: FocusWatch | undefined;
}

/**
 * Run every step and return what was heard, as data.
 *
 * A step that throws is recorded and the sequence continues: one unsupported
 * command should not discard the fifty announcements either side of it. Its
 * `heard` is the error text, so a downstream expectation on that step fails
 * rather than silently passing on an empty string.
 *
 * Losing focus is the opposite case and stops the sequence dead. Once another
 * window has the foreground, every remaining keystroke lands in it rather than
 * in the page, so continuing would both record meaningless steps and type
 * quick-navigation letters into a window that is not ours. There is no useful
 * recovery either: even if focus were won back, the caret position the rest of
 * the sequence depends on is gone. The next target gets a fresh launch and a
 * fresh guard, which is the real recovery.
 */
export async function runSteps(
  nvda: NvdaDriver,
  speech: SpeechLog,
  steps: readonly CompiledStep[],
  { log, onStep, watch }: RunStepsOptions = {},
): Promise<RunStepsResult> {
  const results: StepResult[] = [];
  for (const [index, step] of steps.entries()) {
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
      const result: StepResult = {
        label,
        spec,
        heard,
        ...(expect !== undefined && { expect }),
        ...(snapshot !== undefined && { snapshot }),
      };
      results.push(result);
      log?.(`${shown} :: ${heard.replace(/\n/g, " / ")}`);
      onStep?.(result, index);
    } catch (error) {
      const message = (error as Error)?.message;
      const result: StepResult = {
        label,
        spec,
        heard: `ERROR ${message}`,
        error: message,
        ...(expect !== undefined && { expect }),
        ...(snapshot !== undefined && { snapshot }),
      };
      results.push(result);
      log?.(`${shown} :: ERROR ${message}`);
      onStep?.(result, index);
    }

    // Always check the final step too, so the tail of a transcript is known to
    // be trustworthy rather than merely assumed to be.
    const done = index + 1;
    if (watch && (done % watch.every === 0 || done === steps.length)) {
      const thief = await watch.check();
      if (thief !== null) {
        log?.(`FOCUS LOST after step ${done}: ${thief}`);
        return { steps: results, focusLost: thief, focusLostAfter: done };
      }
    }
  }
  return { steps: results };
}
