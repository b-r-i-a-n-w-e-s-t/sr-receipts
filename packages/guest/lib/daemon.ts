/**
 * The reader, behind a port.
 *
 * The Mac's Playwright is the runner. What it needs from the guest is a reader
 * it can start, ask, and stop, and a browser it can drive: this serves the
 * reader as JSON routes, and `daemon.ts` puts a Playwright browser server
 * beside it. Three things about the shape, each a constraint rather than a
 * preference:
 *
 * - **One reader, one desktop, so calls are serialized.** Two requests
 *   interleaving keystrokes on one NVDA would produce two transcripts of
 *   nothing. Every reader and desktop route waits its turn.
 *
 * - **`start` restarts.** A test that never reached `stop` would otherwise hold
 *   the reader for every test after it. Starting fresh costs a few seconds and
 *   gives each test the reader state the stock fixtures give it.
 *
 * - **A capture window is a pair of routes.** Speech reaches Guidepup's log only
 *   inside one of its actions, and a page action runs on the Mac, so `begin`
 *   opens the window here and answers once the listener is attached; `end`
 *   closes it and returns what was said.
 *
 * The server is a factory taking its desktop, so everything here except NVDA
 * itself is testable on a machine with no NVDA and no desktop.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DaemonHealth, EnterBody } from "@sr-receipts/host";
import { enterDocument } from "./guard.ts";
import type { NvdaDesktop } from "./nvda.ts";

export const DEFAULT_PORT = 8765;
/** Where the Playwright browser server listens; the daemon's port plus one. */
export const DEFAULT_BROWSER_PORT = 8766;

/** A body is a command name, a key, or a page title. Anything larger is a mistake or an attack. */
const MAX_BODY = 1024 * 16;

export interface TokenResolution {
  token: string;
  /** True when there was none to find and one was made up. Print it. */
  generated: boolean;
}

/**
 * Find the token the daemon will require, or make one.
 *
 * Started by hand, the daemon generates a token and prints it, because making
 * someone invent a secret before `npm run daemon` will run is the kind of
 * friction that ends with the auth being removed instead. Started by the
 * scheduled task, with nobody watching stdout, it refuses: a generated token
 * nobody can read is a daemon nothing can talk to.
 */
export function resolveToken({ token, interactive }: { token?: string | undefined; interactive: boolean }): TokenResolution {
  if (token) return { token, generated: false };
  if (!interactive) {
    throw new Error(
      "RIG_TOKEN is not set, and there is no terminal to print a generated one to.\n" +
        "The daemon drives a screen reader and a browser, so it will not start without a token.\n" +
        "Set RIG_TOKEN in the nvda-daemon task's environment (tasks/register.ps1 does this).",
    );
  }
  return { token: randomBytes(24).toString("base64url"), generated: true };
}

export interface RigServerOptions {
  /** Required. Anything that can reach this port drives the guest's reader and browser. */
  token: string;
  desktop: NvdaDesktop;
  /** Where the browser server is, for `/health`. */
  browser: { port: number; path: string };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

/**
 * Constant-time, and length-safe: `timingSafeEqual` throws on a length
 * mismatch, which would otherwise turn a wrong-length token into a 500 and a
 * length oracle.
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error(`body larger than ${MAX_BODY} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function errorChain(error: unknown): string[] {
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

/** Thrown by a route for a body it cannot use; the message is the entire 400. */
class BadRequest extends Error {}

const requireString = (body: Record<string, unknown>, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new BadRequest(`\`${field}\` must be a non-empty string`);
  return value;
};

export function createRigServer({ token, desktop, browser }: RigServerOptions): Server {
  if (!token) throw new Error("a daemon with no token would expose the guest; set RIG_TOKEN");

  let started = false;
  // The mutex: every reader and desktop route runs after the one before it.
  let turn: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  async function handle(method: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    switch (`${method} ${path}`) {
      case "POST /reader/start":
        if (started) await desktop.stop().catch(() => undefined);
        started = false;
        await desktop.start();
        started = true;
        return { ok: true };
      case "POST /reader/stop":
        if (started) {
          started = false;
          await desktop.stop();
        }
        return { ok: true };
      case "POST /reader/enter": {
        const { modeProbes } = body as Partial<EnterBody>;
        if (modeProbes !== undefined && !(Array.isArray(modeProbes) && modeProbes.every((probe) => typeof probe === "string"))) {
          throw new BadRequest("`modeProbes` must be a list of NVDA command names");
        }
        const pageTitle = typeof body.pageTitle === "string" ? body.pageTitle : "";
        return enterDocument(desktop, { pageTitle, ...(modeProbes && { modeProbes }) });
      }
      case "POST /reader/perform":
        return { spoken: await desktop.perform(requireString(body, "command")) };
      case "POST /reader/press":
        return { spoken: await desktop.press(requireString(body, "key")) };
      case "POST /reader/next":
        return { spoken: await desktop.next() };
      case "POST /reader/previous":
        return { spoken: await desktop.previous() };
      case "GET /reader/log":
        return { phrases: await desktop.spokenPhraseLog() };
      case "POST /reader/clear":
        await desktop.clearSpokenPhraseLog();
        return { ok: true };
      case "POST /reader/capture/begin":
        await desktop.captureBegin();
        return { ok: true };
      case "POST /reader/capture/end":
        return { spoken: await desktop.captureEnd() };
      case "GET /desktop/windows":
        return { windows: await desktop.windows() };
      case "POST /desktop/activate":
        return { foreground: await desktop.activateBrowser() };
      default:
        return null;
    }
  }

  return createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://rig.invalid");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    const presented = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!presented) return json(res, 401, { error: "Authorization: Bearer <token> required" });
    if (!tokenMatches(presented, token)) return json(res, 403, { error: "token not accepted" });

    if (method === "GET" && path === "/health") {
      const health: DaemonHealth = { ok: true, started, browser, rig: desktop.environment() };
      return json(res, 200, health);
    }

    void (async () => {
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req);
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch (error) {
        return json(res, 400, { error: `body is not JSON: ${(error as Error).message}` });
      }
      try {
        const result = await serialized(() => handle(method, path, body));
        if (result === null) return json(res, 404, { error: `no route for ${method} ${path}` });
        json(res, 200, result);
      } catch (error) {
        if (error instanceof BadRequest) return json(res, 400, { error: error.message });
        json(res, 500, { error: errorChain(error) });
      }
    })();
  });
}
