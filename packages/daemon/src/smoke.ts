/**
 * The Smoke: does the rig work right now, the way a test uses it?
 *
 * A client of the daemon, and nothing else. It starts NVDA through the
 * daemon's routes, connects to the browser server the daemon launched, opens
 * the control Fixture in it, runs the Focus Guard and four commands through
 * the same `ReaderSession` a test on the Mac has, and stops. What it proves is
 * the posture the product uses: the logon task's daemon, on the interactive
 * desktop, answering with speech. A daemon started over SSH answers every
 * route and hears nothing, and this fails on its guard.
 *
 *   node dist/smoke.js [--transcript artifacts/smoke-transcript.txt]
 *
 *   RIG_TOKEN     required; the daemon's bearer token
 *   RIG_URL       default http://127.0.0.1:<RIG_PORT or 8765>
 *   RIG_BROWSER   default ws://127.0.0.1:<RIG_BROWSER_PORT or 8766>/<token>
 *
 * Runs from any shell on the guest, SSH included: the desktop is the daemon's,
 * not this process's. The Provisioner runs it as its proof and reads the
 * `SmokeResult` from the last line printed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { createNvdaSession, errorChain, type EntryPage, type ReaderSession } from "@sr-receipts/host";
import { DEFAULT_BROWSER_PORT, DEFAULT_PORT } from "./lib/daemon.ts";
import { SMOKE_COMMANDS, SMOKE_CONTROL_FIXTURE, type SmokeResult } from "./lib/smoke-result.ts";
import { delay as wait } from "./lib/system.ts";

/** A daemon the Provisioner just restarted takes a few seconds to launch its browser server and listen. */
export const DAEMON_WAIT_MS = 60_000;

export interface SmokeDependencies {
  session: ReaderSession;
  /** Open the Fixture in the daemon's browser; `close` lets go of the browser afterwards. */
  open(): Promise<{ page: EntryPage; close(): Promise<void> }>;
  /** How long to keep asking the daemon for its stamp before giving up. */
  waitMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

/** The Environment Stamp, once the daemon answers; the daemon may still be starting. */
async function waitForDaemon(session: ReaderSession, waitMs: number, delay: (ms: number) => Promise<void>): Promise<string[]> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await session.environment();
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`the daemon did not answer within ${waitMs / 1000} s; is nvda-daemon running on the signed-in desktop?`, { cause: error });
      }
      await delay(1000);
    }
  }
}

export async function runSmoke({ session, open, waitMs = DAEMON_WAIT_MS, delay = wait }: SmokeDependencies): Promise<SmokeResult> {
  const result: SmokeResult = { ok: false, daemon: false, entered: false, commands: SMOKE_COMMANDS.length, spoke: 0, error: null, environment: [] };
  let close: (() => Promise<void>) | undefined;
  try {
    result.environment = await waitForDaemon(session, waitMs, delay);
    result.daemon = true;
    await session.start();
    const opened = await open();
    close = opened.close;
    await session.enter(opened.page);
    result.entered = true;
    for (const command of SMOKE_COMMANDS) {
      if (await session.perform(command)) result.spoke += 1;
    }
  } catch (error) {
    result.error = errorChain(error).join(" <- ");
  } finally {
    // Whatever happened, the reader is stopped and the browser let go, so the
    // next test finds the rig as the daemon left it. `stop` never throws.
    await session.stop();
    await close?.().catch(() => undefined);
  }
  // The Smoke asserts only that the rig works: the daemon answered, the page
  // was reached, and a command spoke. What was said is a test's business.
  result.ok = result.error === null && result.entered && result.spoke > 0;
  return result;
}

if (process.argv[1] === import.meta.filename) {
  const token = process.env.RIG_TOKEN;
  if (!token) {
    console.error("RIG_TOKEN is not set; the Smoke is a client of the daemon and needs its token (tasks\\register.ps1 sets it for the user).");
    process.exit(2);
  }
  const url = process.env.RIG_URL ?? `http://127.0.0.1:${process.env.RIG_PORT ?? DEFAULT_PORT}`;
  const wsEndpoint = process.env.RIG_BROWSER ?? `ws://127.0.0.1:${process.env.RIG_BROWSER_PORT ?? DEFAULT_BROWSER_PORT}/${token}`;
  const at = process.argv.indexOf("--transcript");
  const transcriptPath = resolve(at === -1 ? "artifacts/smoke-transcript.txt" : (process.argv[at + 1] ?? "artifacts/smoke-transcript.txt"));
  // fixtures/ sits beside src/ and dist/, so this holds for the source and the build.
  const fixture = pathToFileURL(join(import.meta.dirname, "..", "fixtures", SMOKE_CONTROL_FIXTURE)).href;

  const session = createNvdaSession({ url, token });
  const result = await runSmoke({
    session,
    async open() {
      const browser = await chromium.connect(wsEndpoint);
      const page = await browser.newPage();
      await page.goto(fixture, { waitUntil: "load" });
      return { page, close: () => browser.close() };
    },
  });

  const transcript = [`# smoke on ${SMOKE_CONTROL_FIXTURE} through ${url}`, "", ...session.transcript, "", "## environment", ...result.environment];
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, transcript.join("\n") + "\n", "utf8");
  console.log(transcript.join("\n"));
  console.log(result.ok ? "\nSMOKE OK" : `\nSMOKE FAILED: ${result.error ?? "the page was reached but nothing spoke"}`);
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
