/**
 * Matchers for what a reader said, for the consumer's own
 * `expect.extend(readerMatchers)`. Like the fixture, this imports only types
 * from `@playwright/test`, so a linked package never loads a second copy of it.
 *
 * Each takes a spoken string, or a `capture`'s `{ spoken }` directly.
 */
import type { ExpectMatcherState, MatcherReturnType } from "@playwright/test";
import { SILENCE } from "@sr-receipts/host";

type Received = string | { spoken: string };

/**
 * Punctuation a reader voiced or was handed on its own, which a listener
 * hears as noise: a word for a symbol, an ellipsis, or a period standing
 * alone between words. NVDA's utterance joiner (`. `) is not one of these.
 */
const NOISE: [name: string, pattern: RegExp][] = [
  ["a symbol read as a word", /\b(dot|period|full stop|ellipsis)\b/i],
  ["an ellipsis", /\.\.\.|…/],
  ["a period standing alone", /(^|\s)\.(\s|$)/],
];

function spokenOf(received: Received): string {
  if (typeof received === "string") return received;
  if (received && typeof received.spoken === "string") return received.spoken;
  throw new TypeError(`expected a spoken string or a capture's { spoken }, got ${JSON.stringify(received)}`);
}

function show(spoken: string): string {
  return spoken ? JSON.stringify(spoken) : SILENCE;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Text as a pattern that matches it case-insensitively, whatever whitespace
 * the reader put between its words, and never inside a longer word or number:
 * "1 row selected" does not match "21 rows selected".
 */
export function announcementPattern(text: string): RegExp {
  const words = text.trim().split(/\s+/).map(escape).join("\\s+");
  const start = /^\w/.test(text.trim()) ? "(?<!\\w)" : "";
  const end = /\w$/.test(text.trim()) ? "(?!\\w)" : "";
  return new RegExp(start + words + end, "i");
}

export const readerMatchers = {
  /**
   * The reader said this text. A string matches as literal text, see
   * `announcementPattern`; a RegExp is used as it is.
   */
  toAnnounce(this: ExpectMatcherState, received: Received, expected: string | RegExp): MatcherReturnType {
    const spoken = spokenOf(received);
    const pattern = typeof expected === "string" ? announcementPattern(expected) : expected;
    const pass = pattern.test(spoken);
    const wanted = typeof expected === "string" ? JSON.stringify(expected) : String(expected);
    return {
      name: "toAnnounce",
      pass,
      expected,
      actual: spoken,
      message: () => `expected the reader ${this?.isNot ? "not " : ""}to announce ${wanted}\nit said: ${show(spoken)}`,
    };
  },

  /** The reader voiced no punctuation noise: see `NOISE`. */
  toAnnounceCleanly(this: ExpectMatcherState, received: Received): MatcherReturnType {
    const spoken = spokenOf(received);
    const found = NOISE.filter(([, pattern]) => pattern.test(spoken)).map(([name]) => name);
    return {
      name: "toAnnounceCleanly",
      pass: found.length === 0,
      actual: spoken,
      message: () =>
        this?.isNot
          ? `expected punctuation noise, and found none\nit said: ${show(spoken)}`
          : `expected no punctuation noise, and found ${found.join(", ")}\nit said: ${show(spoken)}`,
    };
  },
};
