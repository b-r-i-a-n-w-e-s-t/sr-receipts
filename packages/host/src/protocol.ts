/**
 * The wire between a Mac and a guest daemon, and the one reader interface a
 * test sees for either reader.
 *
 * Owned here, by the side that consumes it, and free of any screen reader's
 * commands: a command crosses the wire as the name Guidepup gives it, and the
 * guest checks it against the reader it drives. The guest implements this
 * contract and depends on this package for it; the Mac never depends on the
 * guest, and nothing here imports Guidepup.
 *
 * Routes, all JSON, all needing `Authorization: Bearer <token>`:
 *
 *   GET  /health                 DaemonHealth
 *   POST /reader/start           start NVDA; a started reader is restarted
 *   POST /reader/stop
 *   POST /reader/enter           EnterBody -> EntryResult: the guards, with
 *                                what they recorded either way
 *   POST /reader/perform         { command } -> Spoken
 *   POST /reader/press           { key } -> Spoken
 *   POST /reader/type            TypeBody -> Spoken: the characters, one
 *                                speech window around all of them
 *   POST /reader/next            Spoken
 *   POST /reader/previous        Spoken
 *   GET  /reader/log             PhraseLog
 *   POST /reader/clear
 *   POST /reader/capture/begin   opens the reader's speech window; answers
 *                                once the speech listener is attached
 *   POST /reader/capture/end     Spoken: closes it and returns what was said
 *
 * The browser itself is not on these routes. The daemon launches a Playwright
 * browser server, and a test reaches it with Playwright's own `connectOptions`
 * at `ws://<guest>:<browser.port><browser.path>`.
 */

/** Each reader a project can run. */
export type Reader = "nvda" | "voiceover";

/**
 * What a reader session needs from a Playwright `page` to reach its content.
 * Structural, so `@playwright/test` is not a dependency of this package.
 */
export interface EntryPage {
  title(): Promise<string>;
  bringToFront(): Promise<void>;
  evaluate(pageFunction: () => unknown): Promise<unknown>;
}

export interface EntryOptions {
  /**
   * NVDA only: the quick-navigation commands that prove browse mode, tried in
   * order. Each exists only in browse mode, so speech from one is positive
   * proof. A page with no table, heading or landmark needs its own probe.
   */
  modeProbes?: string[] | undefined;
}

export interface TypeOptions {
  /**
   * Milliseconds to wait between one key and the next, as in Playwright's
   * `keyboard.type`. Defaults to 0: as fast as the reader's desktop sends them.
   */
  delay?: number | undefined;
}

/** What a page action made the reader say, beside the action's own result. */
export interface Captured<T> {
  result: T;
  spoken: string;
}

/**
 * One reader, started for one test. The same interface for VoiceOver in
 * process on the Mac and for NVDA through the guest daemon, with Guidepup's
 * method names, so a test never says which reader it is asking.
 *
 * Both are built by `createReaderSession`, so on either reader: calls run one
 * at a time in the order they were made, every call rejects rather than
 * throws, and a failed call leaves a line in the transcript.
 */
export interface ReaderSession {
  readonly reader: Reader;
  /**
   * Every call and its answer, one line each, from start to stop. Silence is
   * named. The fixture attaches it to the test: this is the durable record.
   */
  readonly transcript: string[];
  /** A started reader is restarted. */
  start(): Promise<void>;
  /** Never throws: a failed teardown must not mask the error that caused it. */
  stop(): Promise<void>;
  /**
   * Put the reader on the page's content and prove it. Returns what the
   * reader landed on. Throws, with every attempt in the message, when the
   * proof fails, so a test is never certified on a reader that was somewhere
   * else.
   */
  enter(page: EntryPage, options?: EntryOptions): Promise<string>;
  /** One of the reader's own commands, by Guidepup's name for it. Returns what was said. */
  perform(command: string): Promise<string>;
  /** A key combination, e.g. "Control+Home". Returns what was said. */
  press(key: string): Promise<string>;
  /**
   * Type text into whatever has focus, a key per character, as a keyboard
   * user's hands would: the reader is not asked between keys, so the keys
   * arrive at the pace `delay` sets rather than the pace of `press`, which
   * waits out the speech after each one. Returns everything said from the
   * first key until the speech after the last one ended. For a named key,
   * such as "Enter", use `press`.
   */
  type(text: string, options?: TypeOptions): Promise<string>;
  next(): Promise<string>;
  previous(): Promise<string>;
  /**
   * Run a page action inside the reader's speech window, and return what it
   * made the reader say. The action must not call the reader: that call would
   * wait for the capture it is inside, so it is refused.
   */
  capture<T>(action: () => Promise<T>): Promise<Captured<T>>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  /** The Environment Stamp: what produced the speech. */
  environment(): Promise<string[]>;
}

/* --------------------------------------------------------------------- wire */

/**
 * The wire's version, bumped by hand when a route or a body changes shape,
 * and only then. The Mac and the guest are installed at different times, so
 * the daemon reports the version it was built against in `/health`, and the
 * NVDA session refuses a daemon reporting another: a mismatch fails at start
 * with both named, rather than later on whichever route changed. See ADR 0003.
 */
export const PROTOCOL_VERSION = 2;

export interface DaemonHealth {
  ok: true;
  /**
   * The `PROTOCOL_VERSION` this daemon was built against. Optional, because a
   * daemon built without the field answers without it, and the session has
   * to say so rather than assume it.
   */
  protocol?: number;
  /** Whether NVDA is up. */
  started: boolean;
  /** Where Playwright's `connectOptions.wsEndpoint` points on the guest. */
  browser: { port: number; path: string };
  /** The Environment Stamp of the reader this daemon serves. */
  rig: string[];
}

export interface EnterBody {
  /** The page's title, which the browser's window title must start with. */
  pageTitle: string;
  modeProbes?: string[] | undefined;
}

/**
 * How the guards went. `lines` is what the guards recorded, step by step, and
 * goes into the Transcript either way. A failure crosses as the guard's cause
 * chain, outermost first, the same shape a 500 carries.
 */
export type EntryResult =
  | {
      ok: true;
      /** What the reader is on once the guards passed. */
      arrivedOn: string;
      lines: string[];
    }
  | { ok: false; lines: string[]; error: string[] };

export interface TypeBody {
  text: string;
  /** Milliseconds between keys; 0 when absent. */
  delay?: number | undefined;
}

export interface Spoken {
  spoken: string;
}

export interface PhraseLog {
  phrases: string[];
}
