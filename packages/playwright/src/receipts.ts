/**
 * What the fixture does with a scenario before and after the rig runs it,
 * kept free of Playwright so it can be tested with `node --test`.
 */
import type { AuthoredStep, AuthoredStepObject, Reader, Receipt, Scenario } from "@sr-receipts/host";

/** How long a test may take, per reader, before Playwright stops waiting. */
export interface Budgets {
  /** Starting the reader, launching the browser and running the guards, in ms. */
  open: number;
  /** Each step once the page is open, in ms. */
  step: number;
}

/**
 * Starting guesses from ADR 0001, per reader. The first NVDA run measured an
 * open of 41 to 55 seconds and steps of 1.3 to 3.8 seconds with a 1 second
 * settle, so these are generous; they stay until a consumer's suite shows the
 * spread.
 */
export const defaultBudgets: Record<Reader, Budgets> = {
  nvda: { open: 90_000, step: 10_000 },
  voiceover: { open: 90_000, step: 25_000 },
};

/** The object form, the only one that can carry `repeat` and `settle`. */
const isObjectStep = (step: AuthoredStep): step is AuthoredStepObject =>
  typeof step === "object" && !Array.isArray(step);

/** How many steps a scenario expands to, counting each `repeat`. */
export function stepCount(scenario: Scenario): number {
  let count = 0;
  for (const step of scenario.steps) count += (isObjectStep(step) ? step.repeat : undefined) ?? 1;
  return count;
}

/** The time a test gets: one open, plus a step budget for each step, plus each step's settle. */
export function timeoutFor(scenario: Scenario, budgets: Budgets): number {
  let settle = 0;
  for (const step of scenario.steps) {
    if (isObjectStep(step) && step.settle !== undefined) {
      settle += step.settle * (step.repeat ?? 1);
    }
  }
  return budgets.open + budgets.step * stepCount(scenario) + settle;
}

/**
 * A consumer's target is a path or a URL, joined to the project's `baseURL`:
 * the address the guest reaches the host by.
 */
export function resolveTarget(target: string, baseURL: string | undefined): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (!baseURL) {
    throw new Error(`target ${JSON.stringify(target)} is a path, and this project has no receipts baseURL to join it to`);
  }
  return new URL(target, baseURL).href;
}

/**
 * A scenario written for the other reader is a broken run, never a skip: a
 * skip would report a question as answered when nobody asked it.
 */
export function assertReader(scenario: Scenario, reader: Reader): void {
  if (scenario.reader !== reader) {
    throw new Error(
      `scenario ${JSON.stringify(scenario.name ?? "(unnamed)")} is written for ${scenario.reader}, and this project runs ${reader}`,
    );
  }
}

/**
 * The failure message for a Receipt whose verdict is FAIL. The reasons are
 * counts, so each failed expectation and check is listed under them: the test
 * output is where someone reads why, and the transcript is one click further.
 */
export function findings(receipt: Receipt): string {
  const lines = [`FAIL: ${receipt.scenario} on ${receipt.target}`];
  for (const reason of receipt.reasons) lines.push(`  ${reason}`);
  for (const { label, spec, failures } of receipt.failedExpectations) {
    for (const failure of failures) lines.push(`  - step "${label}" (${spec}): ${failure}`);
  }
  for (const check of receipt.checks) {
    if (check.ok) continue;
    for (const failure of check.failures) lines.push(`  - check "${check.name}": ${failure}`);
  }
  return lines.join("\n");
}
