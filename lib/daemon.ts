/**
 * The rig, behind a port.
 *
 * Before this, driving the rig from the host meant putting a `queue.txt` on the
 * guest by some means this repo never recorded, starting a scheduled task, and
 * polling `runs/<runId>/DONE`. This replaces all three with one request the host
 * can await.
 *
 * Three things about the shape, each of which is a constraint rather than a
 * preference:
 *
 * - **`POST /runs` streams.** A run takes minutes, and an HTTP request that
 *   sends nothing for minutes is what sockets and proxies kill. One NDJSON
 *   frame per step keeps the connection busy, and the host gets live progress
 *   as a side effect — the same lines `runner.ts` prints, unformatted.
 *
 * - **One run at a time, and the 409 says so.** NVDA, Firefox and the
 *   foreground window are one shared desktop; two runs cannot interleave on it.
 *   Queueing a second request would hide that behind a promise that looks like
 *   it is making progress. Refusing it names the run in flight instead.
 *
 * - **A disconnected client does not cancel the run.** It holds the desktop;
 *   abandoning it half way leaves NVDA and Firefox up and the next run guessing.
 *   It finishes, and `events.ndjson` beside the transcripts is what a client
 *   that hung up reads to catch up.
 *
 * The server is a factory taking its executor, so everything here except the
 * rig itself is testable on a machine with no NVDA and no desktop.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseQueue } from "./target.ts";
import type { DaemonHealth, DaemonRunBody, RunEvent, RunReport, RunRequest } from "./types.ts";
import type { ExecuteOptions } from "./run.ts";

export const DEFAULT_PORT = 8765;

/** Bodies are a handful of queue lines. Anything larger is a mistake or an attack. */
const MAX_BODY = 1024 * 256;

export interface TokenResolution {
  token: string;
  /** True when there was none to find and one was made up. Print it. */
  generated: boolean;
}

/**
 * Find the token the daemon will require, or make one.
 *
 * The daemon is expected to be started by hand for a session of accessibility
 * work more often than it is left registered, and making someone invent a
 * secret before they can run `npm run daemon` is the kind of friction that ends
 * with the auth being removed instead. So an interactive start generates one
 * and prints it.
 *
 * A non-interactive start — the scheduled task — refuses instead. There is
 * nobody watching stdout to read a generated token, so it would be a secret
 * that exists only in a log file, and the host could never authenticate with
 * it. That is a misconfiguration worth failing on.
 */
export function resolveToken({
  token,
  interactive,
}: {
  token?: string | undefined;
  interactive: boolean;
}): TokenResolution {
  if (token) return { token, generated: false };
  if (!interactive) {
    throw new Error(
      "RIG_TOKEN is not set, and there is no terminal to print a generated one to.\n" +
        "The daemon runs scenario files, so it will not start without a token.\n" +
        "Set RIG_TOKEN in the nvda-daemon task's environment (tasks/register.ps1 does this).",
    );
  }
  return { token: randomBytes(24).toString("base64url"), generated: true };
}

export interface RigServerOptions {
  /**
   * Required. A scenario reference is a path the run layer `import`s, so
   * anything that can reach this port can run code in the guest; there is no
   * unauthenticated mode to fall back to.
   */
  token: string;
  execute: (options: ExecuteOptions) => Promise<RunReport>;
  /** Where a run's output lands, so `GET /runs/:runId/...` can read it back. */
  runDir: (runId: string) => string;
  newRunId: () => string;
  /** The environment block, for `GET /health`. */
  stamp: () => string[];
}

/** What the server is doing, exposed for `/health` and the 409. */
interface InFlight {
  runId: string;
  startedAt: string;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
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
  return new Promise((resolvePromise, reject) => {
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
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Turn a request body into run requests.
 *
 * `queue` goes through the same `parseQueue` the runner uses, so a host that
 * already has a queue file sends its text rather than reimplementing
 * `<target> :: <scenario>`. Throws with a message meant to be read by whoever
 * sent it, because that message is the entire 400.
 */
export function toRequests(body: DaemonRunBody): RunRequest[] {
  const { requests, queue, scenario } = body;
  if (requests !== undefined && queue !== undefined) {
    throw new Error("send either `requests` or `queue`, not both");
  }

  let parsed: RunRequest[];
  if (queue !== undefined) {
    if (typeof queue !== "string") throw new Error("`queue` must be the text of a queue file");
    parsed = parseQueue(queue, scenario ? { defaultScenario: scenario } : {});
  } else if (Array.isArray(requests)) {
    parsed = requests.map((request, index) => {
      const { target, scenario: named } = (request ?? {}) as Partial<RunRequest>;
      if (typeof target !== "string" || !target.trim()) {
        throw new Error(`requests[${index}] names no target`);
      }
      if (named !== undefined && typeof named !== "string") {
        throw new Error(`requests[${index}].scenario must be a string`);
      }
      // An unnamed scenario is only legal when the body supplies the override
      // that would have filled it in.
      if (named === undefined && scenario === undefined) {
        throw new Error(`requests[${index}] names no scenario, and no \`scenario\` override was sent`);
      }
      return { target: target.trim(), scenario: (named ?? scenario) as string };
    });
  } else {
    throw new Error("send `requests` (an array) or `queue` (the text of a queue file)");
  }

  if (parsed.length === 0) throw new Error("no requests to run");
  // An explicit override beats a scenario named on the line, matching
  // `runner.ts --scenario`.
  return scenario ? parsed.map((request) => ({ ...request, scenario })) : parsed;
}

/**
 * Whether a path segment from a URL is safe to join onto a directory.
 *
 * A run id reaches `runDir()` from the URL, and `runDir` is a `join`. The route
 * pattern excludes a literal `/`, but `%2f` and `%2e%2e` survive it and decode
 * into one, so the check has to happen after decoding rather than before.
 * Real run ids are timestamps, so the accepted set is deliberately narrow.
 */
export const isSafeSegment = (segment: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..";

/**
 * Resolve a file inside a run's directory, or null.
 *
 * This route is the one way the port reads guest files by name, so the name is
 * reduced to its basename and the result is checked to be inside the directory
 * it claims to be in — `..` segments survive URL decoding, and `basename`
 * alone would be the whole defence.
 */
export function resolveRunFile(dir: string, name: string): string | null {
  const safe = basename(decodeURIComponent(name));
  if (!safe || safe === "." || safe === "..") return null;
  const path = resolve(dir, safe);
  if (path !== join(resolve(dir), safe)) return null;
  return existsSync(path) ? path : null;
}

export function createRigServer({
  token,
  execute,
  runDir,
  newRunId,
  stamp,
}: RigServerOptions): Server {
  if (!token) throw new Error("a daemon with no token would expose the guest; set RIG_TOKEN");

  let inFlight: InFlight | null = null;

  async function startRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (inFlight) {
      // Not a queue. NVDA and the desktop are a singleton, and pretending
      // otherwise would make a second caller wait on something that looks like
      // progress and is not.
      json(res, 409, {
        error: "a run is already in flight",
        runId: inFlight.runId,
        startedAt: inFlight.startedAt,
      });
      return;
    }

    // Claimed here, synchronously, rather than once the body has been read.
    // Reading the body is an await, and two requests arriving together would
    // both have passed the check above before either reached the assignment —
    // which would put two runs on one desktop, the one thing the check exists
    // to prevent. The id is not known yet, hence the placeholder.
    const startedAt = new Date().toISOString();
    inFlight = { runId: "(reading request)", startedAt };

    let body: DaemonRunBody;
    let requests: RunRequest[];
    try {
      const text = await readBody(req);
      body = text ? (JSON.parse(text) as DaemonRunBody) : {};
      requests = toRequests(body);
    } catch (error) {
      inFlight = null;
      json(res, 400, { error: (error as Error).message });
      return;
    }

    const runId = newRunId();
    const dir = runDir(runId);
    mkdirSync(dir, { recursive: true });
    const eventLog = join(dir, "events.ndjson");

    inFlight = { runId, startedAt };

    // Headers go out before the first event so the client knows the run was
    // accepted, and knows the run id, without waiting for NVDA to start.
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-run-id": runId,
    });

    const emit = (event: RunEvent): void => {
      const frame = JSON.stringify(event) + "\n";
      // Recorded first: this file is what a client that hung up reads back, so
      // it must not depend on the socket still being there.
      try {
        appendFileSync(eventLog, frame, "utf8");
      } catch {
        // a full disk must not stop the run
      }
      if (!res.writableEnded) res.write(frame);
    };

    try {
      await execute({
        requests,
        ...(body.updateSnapshots !== undefined && { updateSnapshots: body.updateSnapshots }),
        onEvent: emit,
        runId,
      });
    } catch (error) {
      // `executeRun` reports a broken run rather than throwing, so reaching
      // here means the executor itself failed. Say so in the stream: the client
      // is waiting on a `run-finished` frame that is never coming.
      emit({ type: "broke", message: (error as Error)?.message ?? String(error) });
    } finally {
      inFlight = null;
      res.end();
    }
  }

  function readRun(res: ServerResponse, runId: string, tail: string): void {
    if (!isSafeSegment(runId)) {
      json(res, 400, { error: "not a run id" });
      return;
    }
    const dir = runDir(runId);
    if (!existsSync(dir)) {
      json(res, 404, { error: `no run ${runId}` });
      return;
    }

    // The report itself.
    if (tail === "") {
      const path = join(dir, "results.json");
      if (!existsSync(path)) {
        json(res, 202, {
          error: "run has not finished",
          runId,
          done: false,
        });
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(readFileSync(path, "utf8"));
      return;
    }

    // The event stream, replayed. For a client that disconnected mid-run.
    if (tail === "events") {
      const path = join(dir, "events.ndjson");
      if (!existsSync(path)) {
        json(res, 404, { error: `run ${runId} recorded no events` });
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(readFileSync(path, "utf8"));
      return;
    }

    if (tail === "files") {
      json(res, 200, { runId, files: readdirSync(dir).sort() });
      return;
    }

    if (tail.startsWith("files/")) {
      const path = resolveRunFile(dir, tail.slice("files/".length));
      if (!path) {
        json(res, 400, { error: "not a file in that run" });
        return;
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(readFileSync(path, "utf8"));
      return;
    }

    json(res, 404, { error: "no such route" });
  }

  return createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://rig.invalid");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const presented = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!presented) {
      json(res, 401, { error: "Authorization: Bearer <token> required" });
      return;
    }
    if (!tokenMatches(presented, token)) {
      json(res, 403, { error: "token not accepted" });
      return;
    }

    if (req.method === "GET" && path === "/health") {
      const health: DaemonHealth = {
        ok: true,
        busy: inFlight !== null,
        runId: inFlight?.runId ?? null,
        rig: stamp(),
      };
      json(res, 200, health);
      return;
    }

    if (req.method === "POST" && path === "/runs") {
      void startRun(req, res);
      return;
    }

    const run = /^\/runs\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (req.method === "GET" && run) {
      readRun(res, decodeURIComponent(run[1] as string), run[2] ?? "");
      return;
    }

    json(res, 404, { error: `no route for ${req.method} ${path}` });
  });
}
