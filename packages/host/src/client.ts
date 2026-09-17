/**
 * The host's side of the daemon.
 *
 * From the Mac, `await rig.run([...])` opens a target in a real screen reader
 * inside the guest and resolves with the verdict.
 *
 * The wire format has exactly one implementation on each side: this client, and
 * the guest's daemon, which implements `./protocol.ts`. `fetch` and nothing
 * else, so it has no dependency and runs on whatever Node the host has.
 */
import type { DaemonHealth, RunEvent, RunReport, RunRequest } from "./protocol.ts";

export interface ClientOptions {
  /** The daemon's base URL, e.g. `http://192.168.64.7:8765`. */
  url: string;
  token: string;
}

export interface RunOptions {
  updateSnapshots?: boolean | undefined;
  /**
   * Every event as it happens, which for a three-minute run is the difference
   * between watching it and waiting for it.
   */
  onEvent?: ((event: RunEvent) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Thrown for anything the daemon refused. `status` distinguishes the cases a
 * caller acts on differently: 409 means another run holds the desktop and this
 * one is worth retrying, 401/403 mean the token is wrong and it is not.
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
 * Split a byte stream into NDJSON frames.
 *
 * A frame can arrive in pieces and several can arrive in one chunk, so the tail
 * after the last newline is held back rather than parsed — the bug this avoids
 * is a half-received event being reported as malformed near the end of a long
 * transcript line.
 */
export async function* readFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<RunEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as RunEvent;
      newline = buffer.indexOf("\n");
    }
  }
  const last = buffer.trim();
  if (last) yield JSON.parse(last) as RunEvent;
}

export interface RigClient {
  health(): Promise<DaemonHealth>;
  /** Resolves when the run finishes. Rejects if the run itself broke. */
  run(requests: RunRequest[], options?: RunOptions): Promise<RunReport>;
  report(runId: string): Promise<RunReport>;
  files(runId: string): Promise<string[]>;
  transcript(runId: string, file: string): Promise<string>;
}

export function createClient({ url, token }: ClientOptions): RigClient {
  const base = url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}` };

  async function get(path: string): Promise<Response> {
    const response = await fetch(`${base}${path}`, { headers });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = (body as { error?: string } | null)?.error ?? response.statusText;
      throw new RigError(response.status, message, body);
    }
    return response;
  }

  return {
    async health() {
      return (await get("/health")).json() as Promise<DaemonHealth>;
    },

    async run(requests, { updateSnapshots, onEvent, signal } = {}) {
      const response = await fetch(`${base}/runs`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          requests,
          ...(updateSnapshots !== undefined && { updateSnapshots }),
        }),
        ...(signal && { signal }),
      });

      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        const message = (body as { error?: string } | null)?.error ?? response.statusText;
        throw new RigError(response.status, message, body);
      }

      const runId = response.headers.get("x-run-id");
      let report: RunReport | undefined;
      let broke: string | undefined;

      for await (const event of readFrames(response.body)) {
        onEvent?.(event);
        if (event.type === "run-finished") report = event.report;
        if (event.type === "broke") broke = event.message;
      }

      // A stream that stopped without a verdict is the interesting failure: the
      // daemon died, or the guest did. Say which run it was, since its output
      // directory is still on the guest and usually explains it.
      if (!report) {
        throw new RigError(
          502,
          broke
            ? `run ${runId ?? "?"} broke: ${broke}`
            : `run ${runId ?? "?"} ended without a verdict`,
          { runId, broke },
        );
      }
      if (report.broke) {
        throw new RigError(502, `run ${report.runId} broke: ${report.broke}`, report);
      }
      return report;
    },

    async report(runId) {
      return (await get(`/runs/${encodeURIComponent(runId)}`)).json() as Promise<RunReport>;
    },

    async files(runId) {
      const body = (await get(`/runs/${encodeURIComponent(runId)}/files`).then((r) =>
        r.json(),
      )) as { files: string[] };
      return body.files;
    },

    async transcript(runId, file) {
      return (
        await get(`/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file)}`)
      ).text();
    },
  };
}
