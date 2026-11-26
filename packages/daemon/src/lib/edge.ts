/**
 * The guest's Edge, launched and owned by the daemon, which a test drives
 * over CDP through the daemon's `/browser`. See ADR 0004.
 *
 * Edge listens for DevTools on loopback only, on a port it picks, and writes
 * the port and its browser WebSocket's path to `DevToolsActivePort` in its
 * profile. The profile is the source of truth for whether this daemon's Edge
 * is up: an endpoint is answered only after Edge has answered on it, so an
 * Edge that has crashed, or one left by a daemon before this one, is found
 * out by asking rather than by tracking a process.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BrowserHealth } from "@sr-receipts/host";

export interface EdgeOptions {
  /** `msedge.exe`, or any Chromium for a test. */
  executable: string;
  /** Edge's user data directory, its own and kept across restarts. */
  profile: string;
  /** More command-line switches, after the ones Edge always gets. */
  args?: string[];
}

export interface Edge {
  /** The browser's DevTools WebSocket on loopback, starting Edge if it is not up. */
  endpoint(): Promise<string>;
  /** Whether Edge is up, starting it if it is not; a start that fails is the reason. */
  health(): Promise<BrowserHealth>;
  /** Ends the Edge this process started, if it did. */
  close(): Promise<void>;
}

/** Longer than Edge's first start on a cold ARM64 guest. */
const START_TIMEOUT = 30_000;

export function createEdge({ executable, profile, args = [] }: EdgeOptions): Edge {
  const portFile = join(profile, "DevToolsActivePort");
  let child: ChildProcess | undefined;
  // One start at a time: two callers at once get the same Edge.
  let starting: Promise<string> | undefined;

  /** The endpoint the profile names, if Edge answers on it. */
  async function running(): Promise<string | undefined> {
    let port: string, path: string;
    try {
      [port, path] = readFileSync(portFile, "utf8").split("\n") as [string, string];
    } catch {
      return undefined;
    }
    const answers = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) }).then(
      (response) => response.ok,
      () => false,
    );
    return answers ? `ws://127.0.0.1:${port}${path}` : undefined;
  }

  function start(): Promise<string> {
    // A file left by an Edge that no longer answers would be read as the new one's.
    rmSync(portFile, { force: true });
    const launched = spawn(
      executable,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=msEdgeFRE",
        // NVDA reads a window, but nothing should be on screen between tests:
        // each test's context opens its own.
        "--no-startup-window",
        ...args,
      ],
      { stdio: "ignore" },
    );
    child = launched;
    return new Promise((resolve, reject) => {
      const fail = (reason: string): void => {
        clearInterval(poll);
        reject(new Error(`Edge did not start from ${executable}: ${reason}`));
      };
      launched.once("error", (error) => fail(error.message));
      launched.once("exit", (code, signal) => fail(`it exited (${signal ?? `code ${code}`}) before it was listening`));
      const deadline = Date.now() + START_TIMEOUT;
      const poll = setInterval(() => {
        void running().then((endpoint) => {
          if (endpoint) {
            clearInterval(poll);
            launched.removeAllListeners("exit");
            resolve(endpoint);
          } else if (Date.now() > deadline) {
            fail(`it was not listening after ${START_TIMEOUT / 1000} s`);
            launched.kill();
          }
        });
      }, 100);
    });
  }

  async function endpoint(): Promise<string> {
    const up = await running();
    if (up) return up;
    starting ??= start().finally(() => (starting = undefined));
    return starting;
  }

  return {
    endpoint,
    async health() {
      try {
        await endpoint();
        return { running: true };
      } catch (error) {
        return { running: false, error: (error as Error).message };
      }
    },
    async close() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child?.once("exit", resolve));
      child.kill();
      await exited;
    },
  };
}
