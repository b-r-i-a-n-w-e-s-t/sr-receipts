/**
 * Declarative expectations on what NVDA said.
 *
 * Two kinds, and the difference matters:
 *
 * - A step's `expect` states what must be true of that announcement *whatever
 *   the target*. "This step must reach a table", "this step must not be silent",
 *   "the coordinate must be announced". These live in the scenario, because they
 *   are the scenario's intent.
 *
 * - Exact wording lives in a snapshot instead (see lib/snapshot.ts), because it
 *   is a property of one target, not of the question being asked. Putting
 *   `equals: "Historical Structures, table, with 16 rows"` in a scenario would
 *   make that scenario runnable against exactly one fixture.
 *
 * A scenario's `checks` are the third kind: assertions across the whole
 * transcript rather than one step, which is how "the detail is announced once,
 * not twice" gets asked.
 */
import { SILENCE } from "./speech.ts";
import type { Check, CheckResult, Expectation, Expectations, StepResult } from "./types.ts";

const asRegExp = (value: string | RegExp): RegExp =>
  value instanceof RegExp ? value : new RegExp(value, "i");

/** A short, quotable form of an announcement, for a failure message. */
export const quote = (text: string): string => {
  const oneLine = text.replace(/\n/g, " / ");
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
};

type MatcherName = Exclude<keyof Expectation, "not">;

const MATCHERS: { [K in MatcherName]: (heard: string, value: never) => string | null } = {
  includes: (heard: string, value: string) =>
    heard.toLowerCase().includes(String(value).toLowerCase())
      ? null
      : `expected to include ${JSON.stringify(value)}`,

  matches: (heard: string, value: string | RegExp) =>
    asRegExp(value).test(heard) ? null : `expected to match ${asRegExp(value)}`,

  equals: (heard: string, value: string) =>
    heard === value ? null : `expected exactly ${JSON.stringify(value)}`,

  silent: (heard: string, value: boolean) => {
    const isSilent = heard === SILENCE;
    if (isSilent === Boolean(value)) return null;
    return value ? "expected silence" : "expected something to be said";
  },
} as { [K in MatcherName]: (heard: string, value: never) => string | null };

/**
 * Check one announcement against one expectation.
 *
 * Returns an array of failure reasons, empty when it holds. Every matcher in the
 * expectation is evaluated rather than stopping at the first failure, because a
 * transcript is read once and should say everything that is wrong with it.
 */
export function evaluate(heard: string, expectation?: Expectations | null): string[] {
  if (expectation === undefined || expectation === null) return [];

  if (Array.isArray(expectation)) {
    return expectation.flatMap((one) => evaluate(heard, one));
  }

  if (typeof expectation !== "object") {
    throw new Error(
      `expectation must be an object or an array of them, got ${typeof expectation}`,
    );
  }

  const failures: string[] = [];
  for (const [name, value] of Object.entries(expectation)) {
    if (name === "not") {
      const negated = evaluate(heard, value as Expectation);
      if (negated.length === 0) {
        failures.push(`expected NOT to satisfy ${JSON.stringify(value)}`);
      }
      continue;
    }
    const matcher = MATCHERS[name as MatcherName];
    if (!matcher) {
      throw new Error(
        `unknown matcher ${JSON.stringify(name)}; known: ${Object.keys(MATCHERS).join(", ")}, not`,
      );
    }
    const failure = matcher(heard, value as never);
    if (failure) failures.push(`${failure}, heard ${quote(heard)}`);
  }
  return failures;
}

/** Structural validation, so a bad matcher name is caught before NVDA starts. */
export function validateExpectation(expectation: unknown, where: string): void {
  try {
    evaluate("", expectation as Expectations | undefined);
  } catch (error) {
    throw new Error(`${where}: ${(error as Error).message}`);
  }
}

/**
 * A scenario-level check: count the steps whose announcement matches, and assert
 * something about that count.
 *
 *   { name: "detail announced once, not twice",
 *     matches: "Additional Details", equals: 1 }
 *
 * `equals`, `atLeast` and `atMost` may be combined. This is how the question the
 * rig was built for — is the expandable detail read out twice? — becomes
 * something a build can fail on.
 */
export function runCheck(
  check: Check,
  steps: readonly Pick<StepResult, "label" | "heard">[],
): CheckResult {
  const pattern = asRegExp(check.matches);
  const matched = steps.filter((step) => pattern.test(step.heard));
  const count = matched.length;
  const failures: string[] = [];

  if (check.equals !== undefined && count !== check.equals) {
    failures.push(`expected ${check.equals}, found ${count}`);
  }
  if (check.atLeast !== undefined && count < check.atLeast) {
    failures.push(`expected at least ${check.atLeast}, found ${count}`);
  }
  if (check.atMost !== undefined && count > check.atMost) {
    failures.push(`expected at most ${check.atMost}, found ${count}`);
  }

  return {
    name: check.name,
    pattern: String(pattern),
    count,
    ok: failures.length === 0,
    failures,
    matchedLabels: matched.map((step) => step.label),
  };
}

export function validateCheck(check: unknown, where: string): void {
  if (typeof check !== "object" || check === null) {
    throw new Error(`${where}: a check must be an object`);
  }
  const candidate = check as Partial<Check>;
  if (!candidate.name) throw new Error(`${where}: a check needs a "name"`);
  if (candidate.matches === undefined) {
    throw new Error(`${where}: check ${JSON.stringify(candidate.name)} needs "matches"`);
  }
  const bounds = (["equals", "atLeast", "atMost"] as const).filter(
    (key) => candidate[key] !== undefined,
  );
  if (bounds.length === 0) {
    throw new Error(
      `${where}: check ${JSON.stringify(candidate.name)} needs one of equals, atLeast, atMost`,
    );
  }
  for (const bound of bounds) {
    const value = candidate[bound];
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error(
        `${where}: check ${JSON.stringify(candidate.name)} "${bound}" must be a non-negative integer`,
      );
    }
  }
  asRegExp(candidate.matches);
}
