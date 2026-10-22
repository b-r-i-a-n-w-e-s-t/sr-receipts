/**
 * NVDA as a `ReaderSession`, over the guest daemon's routes.
 *
 * `fetch` and nothing else, so it has no dependency and runs on whatever Node
 * the Mac has. The wire format has exactly one implementation on each side:
 * this adapter, and the guest's daemon. The contract test that runs the two
 * together is in `@sr-receipts/daemon`, which can depend on this package.
 */
import { PROTOCOL_VERSION, type DaemonHealth, type EnterBody, type EntryResult, type PhraseLog, type ReaderSession, type SessionOptions, type Spoken, type TypeBody } from "./protocol.ts";
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
export function createNvdaSession(options: ClientOptions & SessionOptions): ReaderSession {
  const call = caller(options);
  const spoken = async (path: string, body?: unknown): Promise<string> => (await call<Spoken>("POST", path, body)).spoken;

  return createReaderSession({
    reader: "nvda",

    async start() {
      const daemon = await daemonHealth(options);
      if (daemon.protocol !== PROTOCOL_VERSION) {
        throw new Error(
          `the guest daemon at ${options.url} speaks wire protocol ${daemon.protocol ?? "none"}, and this host speaks ${PROTOCOL_VERSION}; ` +
            "bring the older side up to date: bootstrap.ps1 on the guest, or npm on the Mac",
        );
      }
      await call("POST", "/reader/start");
    },

    stop: () => call("POST", "/reader/stop"),

    async enter(page, { modeProbes }, record) {
      await page.bringToFront();
      const body: EnterBody = { pageTitle: await page.title(), ...(modeProbes && { modeProbes }) };
      const result = await call<EntryResult>("POST", "/reader/enter", body);
      // What the guards recorded goes into the Transcript whether they passed
      // or not; the session adds the heading and the reason after it.
      record(...result.lines);
      if (result.ok) return result.arrivedOn;
      throw new Error(result.error.join(" <- "));
    },

    perform: (command) => spoken("/reader/perform", { command }),
    press: (key) => spoken("/reader/press", { key }),
    type: (text, { delay }) => spoken("/reader/type", { text, ...(delay !== undefined && { delay }) } satisfies TypeBody),
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
    environment: async () => (await daemonHealth(options)).rig,
  }, options);
}

/** Requests to one daemon, with its token; anything refused is a `RigError`. */
function caller({ url, token }: ClientOptions) {
  const base = url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  return async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
  };
}

/**
 * The daemon's `/health`: its wire protocol, the browser server's path, and
 * the guest's Environment Stamp. A daemon that does not answer is named with
 * what usually causes that.
 */
export async function daemonHealth(options: ClientOptions): Promise<DaemonHealth> {
  try {
    return await caller(options)<DaemonHealth>("GET", "/health");
  } catch (error) {
    if (error instanceof RigError) throw error;
    throw new Error(`the guest daemon at ${options.url} is not reachable; is the VM booted, signed in, and nvda-daemon running?`, {
      cause: error,
    });
  }
}
