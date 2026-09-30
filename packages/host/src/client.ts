/**
 * NVDA as a `ReaderSession`, over the guest daemon's routes.
 *
 * `fetch` and nothing else, so it has no dependency and runs on whatever Node
 * the Mac has. The wire format has exactly one implementation on each side:
 * this adapter, and the guest's daemon. The contract test that runs the two
 * together is in `@sr-receipts/guest`, which can depend on this package.
 */
import type { DaemonHealth, EnterBody, EntryResult, PhraseLog, ReaderSession, Spoken } from "./protocol.ts";
import { createReaderSession } from "./session.ts";

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

/**
 * The guards run on the guest (`POST /reader/enter`): they need the browser's
 * window activated from inside the interactive session, which nothing on the
 * Mac can do. What crosses the wire for them is the page's title.
 */
export function createNvdaSession({ url, token }: ClientOptions): ReaderSession {
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
  const spoken = async (path: string, body?: unknown): Promise<string> => (await call<Spoken>("POST", path, body)).spoken;
  const health = () => call<DaemonHealth>("GET", "/health");

  return createReaderSession({
    reader: "nvda",

    async start() {
      try {
        await health();
      } catch (error) {
        if (error instanceof RigError) throw error;
        throw new Error(`the guest daemon at ${url} is not reachable; is the VM booted, signed in, and nvda-daemon running?`, {
          cause: error,
        });
      }
      await call("POST", "/reader/start");
    },

    stop: () => call("POST", "/reader/stop"),

    async enter(page, { modeProbes }, record) {
      await page.bringToFront();
      const body: EnterBody = { pageTitle: await page.title(), ...(modeProbes && { modeProbes }) };
      const result = await call<EntryResult>("POST", "/reader/enter", body);
      if (result.ok) {
        record(...result.lines);
        return result.arrivedOn;
      }
      // The guard's first line is its verdict; the rest is how it got there.
      const [verdict = "the guards failed", ...lines] = result.lines;
      record(...lines);
      throw new Error(verdict.replace(/^#+\s*/, ""));
    },

    perform: (command) => spoken("/reader/perform", { command }),
    press: (key) => spoken("/reader/press", { key }),
    next: () => spoken("/reader/next"),
    previous: () => spoken("/reader/previous"),

    async capture(action) {
      await call("POST", "/reader/capture/begin");
      let result;
      try {
        result = await action();
      } catch (error) {
        // The window has to close whatever the action did, or the next call
        // finds a capture still open.
        await spoken("/reader/capture/end").catch(() => undefined);
        throw error;
      }
      return { result, spoken: await spoken("/reader/capture/end") };
    },

    spokenPhraseLog: async () => (await call<PhraseLog>("GET", "/reader/log")).phrases,
    clearSpokenPhraseLog: async () => void (await call("POST", "/reader/clear")),
    environment: async () => (await health()).rig,
  });
}
