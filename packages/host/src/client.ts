/**
 * The Mac's side of the daemon: a client for its routes, and NVDA as a
 * `ReaderSession` built on it.
 *
 * `fetch` and nothing else, so it has no dependency and runs on whatever Node
 * the Mac has. The wire format has exactly one implementation on each side:
 * this client, and the guest's daemon.
 */
import type {
  Activation,
  Captured,
  DaemonHealth,
  EnterBody,
  EntryOptions,
  EntryPage,
  EntryResult,
  PhraseLog,
  ReaderSession,
  Spoken,
  Windows,
} from "./protocol.ts";

/**
 * What a transcript records for a call that made the reader say nothing.
 * Named, because a blank line in a transcript is indistinguishable from a
 * formatting accident, and because silence is a result: it is what a
 * quick-navigation command answers in focus mode, and what a missing
 * accessible name sounds like.
 */
export const SILENCE = "(silence)";

export interface ClientOptions {
  /** The daemon's base URL, e.g. `http://192.168.64.3:8765`. */
  url: string;
  token: string;
}

/**
 * Thrown for anything the daemon refused. `status` distinguishes the cases a
 * caller acts on differently: 401 and 403 mean the token is wrong, 500 means
 * the reader failed and `body.error` says how.
 */
export class RigError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "RigError";
    this.status = status;
    this.body = body;
  }
}

/** The daemon's routes, one method each. */
export interface RemoteReader {
  health(): Promise<DaemonHealth>;
  start(): Promise<void>;
  stop(): Promise<void>;
  enter(body: EnterBody): Promise<EntryResult>;
  perform(command: string): Promise<string>;
  press(key: string): Promise<string>;
  next(): Promise<string>;
  previous(): Promise<string>;
  log(): Promise<string[]>;
  clear(): Promise<void>;
  captureBegin(): Promise<void>;
  captureEnd(): Promise<string>;
  windows(): Promise<string[]>;
  activateBrowser(): Promise<string>;
}

export function connectReader({ url, token }: ClientOptions): RemoteReader {
  const base = url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as { error?: string | string[] } | null)?.error;
      const message = error === undefined ? response.statusText : [error].flat().join(" <- ");
      throw new RigError(response.status, `${method} ${path}: ${message}`, payload);
    }
    return payload as T;
  }
  const spoken = async (path: string, body?: unknown): Promise<string> =>
    (await call<Spoken>("POST", path, body)).spoken;

  return {
    health: () => call<DaemonHealth>("GET", "/health"),
    start: () => call("POST", "/reader/start"),
    stop: () => call("POST", "/reader/stop"),
    enter: (body) => call<EntryResult>("POST", "/reader/enter", body),
    perform: (command) => spoken("/reader/perform", { command }),
    press: (key) => spoken("/reader/press", { key }),
    next: () => spoken("/reader/next"),
    previous: () => spoken("/reader/previous"),
    log: async () => (await call<PhraseLog>("GET", "/reader/log")).phrases,
    clear: () => call("POST", "/reader/clear"),
    captureBegin: () => call("POST", "/reader/capture/begin"),
    captureEnd: () => spoken("/reader/capture/end"),
    windows: async () => (await call<Windows>("GET", "/desktop/windows")).windows,
    activateBrowser: async () => (await call<Activation>("POST", "/desktop/activate")).foreground,
  };
}

/**
 * NVDA as a `ReaderSession`: the daemon's routes behind the interface a test
 * uses, with the transcript kept here on the Mac.
 *
 * The guards run on the guest (`POST /reader/enter`): they need the browser's
 * window activated from inside the interactive session, which nothing on the
 * Mac can do. What crosses the wire for them is the page's title.
 */
export function createNvdaSession(options: ClientOptions): ReaderSession {
  const remote = connectReader(options);
  const transcript: string[] = [];
  const said = async (label: string, request: () => Promise<string>): Promise<string> => {
    const spoken = await request();
    transcript.push(`${label}: ${spoken || SILENCE}`);
    return spoken;
  };

  return {
    reader: "nvda",
    transcript,

    async start() {
      try {
        await remote.health();
      } catch (error) {
        if (error instanceof RigError) throw error;
        throw new Error(
          `the guest daemon at ${options.url} is not reachable; is the VM booted, signed in, and nvda-daemon running?`,
          { cause: error },
        );
      }
      await remote.start();
      transcript.push("start NVDA: ok");
    },

    async stop() {
      try {
        await remote.stop();
      } catch (error) {
        transcript.push(`stop NVDA: ${(error as Error).message}`);
      }
    },

    async enter(page: EntryPage, { modeProbes }: EntryOptions = {}) {
      await page.bringToFront();
      const pageTitle = await page.title();
      const result = await remote.enter({ pageTitle, ...(modeProbes && { modeProbes }) });
      transcript.push(...result.lines);
      if (!result.ok) {
        throw new Error(`NVDA did not reach the page in browse mode:\n${result.lines.join("\n")}`);
      }
      return result.arrivedOn;
    },

    perform: (command) => said(command, () => remote.perform(command)),
    press: (key) => said(`press ${key}`, () => remote.press(key)),
    next: () => said("next", () => remote.next()),
    previous: () => said("previous", () => remote.previous()),

    async capture<T>(action: () => Promise<T>): Promise<Captured<T>> {
      await remote.captureBegin();
      let result: T;
      try {
        result = await action();
      } catch (error) {
        // The window has to close whatever the action did, or the next call
        // finds a capture still open.
        await remote.captureEnd().catch(() => undefined);
        throw error;
      }
      const spoken = await remote.captureEnd();
      transcript.push(`page action: ${spoken || SILENCE}`);
      return { result, spoken };
    },

    spokenPhraseLog: () => remote.log(),
    clearSpokenPhraseLog: () => remote.clear(),
    environment: async () => (await remote.health()).rig,
  };
}
