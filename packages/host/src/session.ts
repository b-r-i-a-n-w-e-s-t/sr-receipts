/**
 * The Reader Session: what every reader's session does the same way, once.
 *
 * A reader adapter knows how to drive one screen reader and returns what it
 * said. This module wraps it into the `ReaderSession` a test sees, and owns
 * the invariants a test relies on whichever reader it has:
 *
 * - **The Transcript.** One line per call with its answer, silence named, and
 *   a line for a call that failed, so a failure is never a gap.
 * - **Calls are serialized.** One desktop cannot interleave two callers'
 *   keystrokes, so a spec's `Promise.all` over two reader calls runs them one
 *   after the other, in the order they were made.
 * - **Every call rejects, never throws.** A consumer's `.catch` sees an
 *   unknown command like any other failure.
 * - **`start` restarts, and `stop` never throws.** A reader left running by a
 *   test that never stopped it cannot hold it for the next; a failed teardown
 *   must not mask the error that caused it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Captured, EntryOptions, EntryPage, Reader, ReaderSession, TypeOptions } from "./protocol.ts";

/**
 * What a transcript records for a call that made the reader say nothing.
 * Named, because a blank line in a transcript is indistinguishable from a
 * formatting accident, and because silence is a result: it is what a
 * quick-navigation command answers in focus mode, and what a missing
 * accessible name sounds like.
 */
export const SILENCE = "(silence)";

/** Appends lines to the Transcript. */
export type Recorder = (...lines: string[]) => void;

/**
 * One screen reader's raw calls, each returning what the reader said, `""`
 * for silence. Its methods may throw or reject; the session records either.
 */
export interface ReaderAdapter {
  readonly reader: Reader;
  /** Start the reader, recording anything the start had to do, such as a retried launch. */
  start(record: Recorder): Promise<void>;
  stop(): Promise<void>;
  /**
   * Put the reader on the page's content and prove it, recording each step
   * of the proof. Returns what it landed on; throws when the proof fails.
   */
  enter(page: EntryPage, options: EntryOptions, record: Recorder): Promise<string>;
  perform(command: string): Promise<string>;
  press(key: string): Promise<string>;
  /** The characters of `text` as keys, inside one speech window. */
  type(text: string, options: TypeOptions): Promise<string>;
  next(): Promise<string>;
  previous(): Promise<string>;
  capture<T>(action: () => Promise<T>): Promise<Captured<T>>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  environment(): Promise<string[]>;
}

const NAMES: Record<Reader, string> = { nvda: "NVDA", voiceover: "VoiceOver" };

/** An error and its causes, outermost first, for one transcript line. */
export function errorChain(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  while (current) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages;
}

export function createReaderSession(adapter: ReaderAdapter): ReaderSession {
  const name = NAMES[adapter.reader];
  const transcript: string[] = [];
  const record: Recorder = (...lines) => void transcript.push(...lines);
  const failed = (label: string, error: unknown): void => record(`${label}: failed: ${errorChain(error).join(" <- ")}`);
  let started = false;

  // The mutex. A call made from inside a queued call, such as a reader call
  // in capture's page action, would wait for itself forever, so it is refused.
  const inside = new AsyncLocalStorage<true>();
  let turn: Promise<unknown> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    if (inside.getStore()) {
      return Promise.reject(new Error(`a ${name} call was made while another was running, from inside it; a capture's action must not call the reader`));
    }
    const next = turn.then(
      () => inside.run(true, work),
      () => inside.run(true, work),
    );
    turn = next.catch(() => undefined);
    return next;
  }

  const said = (label: string, call: () => Promise<string>): Promise<string> =>
    serialized(async () => {
      try {
        const spoken = await call();
        record(`${label}: ${spoken || SILENCE}`);
        return spoken;
      } catch (error) {
        failed(label, error);
        throw error;
      }
    });

  async function stop(): Promise<void> {
    // Not queued: a teardown after a timed-out test must not wait behind the
    // call that hung, or the reader is left running.
    started = false;
    try {
      await adapter.stop();
    } catch (error) {
      record(`stop ${name}: ${errorChain(error).join(" <- ")}`);
    }
  }

  return {
    reader: adapter.reader,
    transcript,

    start: () =>
      serialized(async () => {
        if (started) await stop();
        try {
          await adapter.start(record);
        } catch (error) {
          failed(`start ${name}`, error);
          throw error;
        }
        started = true;
        record(`start ${name}: ok`);
      }),

    stop,

    enter: (page, options = {}) =>
      serialized(async () => {
        try {
          return await adapter.enter(page, options, record);
        } catch (error) {
          record(`### ${name.toUpperCase()} DID NOT REACH THE PAGE`, errorChain(error).join(" <- "));
          throw new Error(`${name} did not reach the page:\n${transcript.join("\n")}`, { cause: error });
        }
      }),

    perform: (command) => said(command, () => adapter.perform(command)),
    press: (key) => said(`press ${key}`, () => adapter.press(key)),
    type: (text, options = {}) =>
      said(`type ${JSON.stringify(text)}${options.delay ? `, ${options.delay} ms between keys` : ""}`, () => adapter.type(text, options)),
    next: () => said("next", () => adapter.next()),
    previous: () => said("previous", () => adapter.previous()),

    capture: <T>(action: () => Promise<T>): Promise<Captured<T>> =>
      serialized(async () => {
        try {
          const captured = await adapter.capture(action);
          record(`page action: ${captured.spoken || SILENCE}`);
          return captured;
        } catch (error) {
          failed("page action", error);
          throw error;
        }
      }),

    spokenPhraseLog: () => serialized(async () => adapter.spokenPhraseLog()),
    clearSpokenPhraseLog: () => serialized(async () => adapter.clearSpokenPhraseLog()),
    environment: async () => adapter.environment(),
  };
}
