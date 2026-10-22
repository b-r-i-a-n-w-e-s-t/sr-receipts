/**
 * The `reader` fixture: a real screen reader beside Playwright's own `page`.
 *
 * Playwright drives the browser. For a VoiceOver project that is the browser
 * Playwright launched on this Mac; for an NVDA project it is the guest's Edge,
 * reached through Playwright's own `connectOptions`. The reader comes from
 * here: VoiceOver in process through `@sr-receipts/voiceover`, NVDA through the
 * guest daemon's routes in `@sr-receipts/host`. Both are the same
 * `ReaderSession`, so a spec never says which one it has. See ADR 0002.
 *
 * Applied to the consumer's own `test` by `withReader`, and importing
 * only types from `@playwright/test`. Playwright refuses to load a second copy
 * of itself, and a linked package resolves its imports from where it really
 * lives, which is not the consumer's `node_modules`.
 */
import type { Fixtures, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions, TestType } from "@playwright/test";
import { createNvdaSession, daemonHealth, type Reader, type ReaderSession, type SessionOptions } from "@sr-receipts/host";

import { writeReceiptFile, type ReceiptTestInfo } from "./receipt-file.ts";

/**
 * A project's `use: { readerOptions }`. NVDA is reached through the guest
 * daemon, so only an NVDA project has its `url` and `token`; VoiceOver runs
 * in-process on this Mac.
 */
export type ReaderOptions =
  | {
      reader: "nvda";
      /** The guest daemon's base URL, e.g. `http://192.168.64.3:8765`. */
      url: string;
      token: string;
    }
  | {
      reader: "voiceover";
      /**
       * The browser's application name as macOS knows it, for VoiceOver's
       * activation. Defaults from the project's `browserName` and `channel`:
       * Playwright's WebKit is "Playwright", its Chromium "Google Chrome for
       * Testing", its Firefox "Nightly", and a branded channel its own name.
       */
      applicationName?: string;
    };

/** What Guidepup's Playwright package maps each browser to. */
const APPLICATION_NAMES: Record<string, string> = {
  chromium: "Google Chrome for Testing",
  chrome: "Google Chrome",
  "chrome-beta": "Google Chrome Beta",
  msedge: "Microsoft Edge",
  "msedge-beta": "Microsoft Edge Beta",
  "msedge-dev": "Microsoft Edge Dev",
  firefox: "Nightly",
  webkit: "Playwright",
};

export function applicationNameFor(browserName: string, channel: string | undefined): string {
  return APPLICATION_NAMES[channel ?? browserName] ?? APPLICATION_NAMES[browserName] ?? browserName;
}

/**
 * What the VoiceOver half needs from `@sr-receipts/voiceover`, an optional
 * peer. Written out rather than taken from that package's types, so an
 * NVDA-only consumer's typecheck finds nothing here it has not installed. The
 * default `load` below holds it to the real package when this one builds.
 */
export interface VoiceOverPackage {
  createVoiceOverSession(options: { applicationName: string } & SessionOptions): ReaderSession;
}

export async function loadVoiceOver(load: () => Promise<VoiceOverPackage> = () => import("@sr-receipts/voiceover")): Promise<VoiceOverPackage> {
  try {
    return await load();
  } catch (error) {
    // Only the package itself missing: a missing module inside it is a broken
    // install, and its own message says which.
    const { code, message } = error as { code?: string; message?: string };
    if (code === "ERR_MODULE_NOT_FOUND" && message?.includes("'@sr-receipts/voiceover'")) {
      throw new Error("a VoiceOver project needs @sr-receipts/voiceover installed beside @sr-receipts/playwright", { cause: error });
    }
    throw error;
  }
}

/** Build the project's session, started by the fixture. */
export async function createSession(
  options: ReaderOptions,
  browser: { browserName: string; channel: string | undefined },
  sessionOptions: SessionOptions = {},
  load?: () => Promise<VoiceOverPackage>,
): Promise<ReaderSession> {
  if (options.reader === "nvda") return createNvdaSession({ url: options.url, token: options.token, ...sessionOptions });
  const { createVoiceOverSession } = await loadVoiceOver(load);
  return createVoiceOverSession({ applicationName: options.applicationName ?? applicationNameFor(browser.browserName, browser.channel), ...sessionOptions });
}

/**
 * What produced the speech. NVDA's browser is the guest's Edge, which the
 * guest's own stamp names with its version; the project's `browserName` there
 * is only the protocol Playwright connected with. VoiceOver's browser is the
 * one Playwright launched on this Mac, which the Mac's stamp cannot name.
 */
export function environmentStamp(reader: Reader, readerStamp: string[], browser: { name: string; version: string }): string[] {
  return reader === "nvda" ? readerStamp : [...readerStamp, `browser: ${browser.name} ${browser.version}`];
}

/**
 * Why Playwright would refuse the guest's browser server, or `undefined`.
 * Playwright refuses a client of another major.minor at connect, as a
 * WebSocket error that names neither fix, so this is checked first. The
 * guest's version is read from its stamp; a stamp without it is let through.
 */
export function playwrightMismatch(rig: string[], client: string): string | undefined {
  const guest = rig.join("\n").match(/driven by playwright-core (\d+\.\d+)\./)?.[1];
  const ours = client.match(/^\d+\.\d+/)?.[0];
  if (guest === undefined || ours === undefined || guest === ours) return undefined;
  return (
    `the guest's Edge is served by Playwright ${guest} and this run is Playwright ${ours}, and Playwright refuses a client of another minor version: ` +
    `install @playwright/test@${guest} here, or bring the guest to a daemon built on Playwright ${ours}`
  );
}

/**
 * The preflight's body, given how to read the daemon's health. Automatic and
 * worker-scoped, so it runs before Playwright's `browser` connects to the
 * guest; an unreachable daemon fails here too, named, rather than as that
 * connect's WebSocket error.
 */
export function readerPreflight(health: typeof daemonHealth = daemonHealth) {
  return async (
    { readerOptions }: { readerOptions: ReaderOptions | undefined },
    use: () => Promise<void>,
    workerInfo: { config: { version: string } },
  ): Promise<void> => {
    if (readerOptions?.reader === "nvda") {
      const mismatch = playwrightMismatch((await health(readerOptions)).rig, workerInfo.config.version);
      if (mismatch) throw new Error(mismatch);
    }
    await use();
  };
}

/**
 * A spec's `test.use({ receipt })`: what its Receipt File keeps beside the
 * reader's words. An object rather than a bare function, because Playwright
 * takes a function in `test.use` as the fixture itself and runs it in Node.
 */
export interface ReceiptOptions {
  /**
   * What to read from the page after each Step, a column per key. Run in the
   * page, so it cannot close over anything in the spec.
   */
  state?: () => Record<string, unknown>;
}

type ReaderTestFixtures = { reader: ReaderSession; receipt: ReceiptOptions | undefined };
type ReaderWorkerFixtures = { readerOptions: ReaderOptions | undefined; readerPreflight: void };
type BaseTestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type BaseWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

type ReaderFixtures = Fixtures<ReaderTestFixtures, ReaderWorkerFixtures, BaseTestArgs, BaseWorkerArgs>;

/** What the fixture's body needs from Playwright's own fixtures and `testInfo`. */
interface ReaderFixtureArgs {
  readerOptions: ReaderOptions | undefined;
  browser: { version(): string };
  browserName: string;
  channel: string | undefined;
  page: { evaluate<R>(fn: () => R): Promise<R> };
  receipt: ReceiptOptions | undefined;
}
interface ReaderTestInfo extends ReceiptTestInfo {
  attach(name: string, options: { body: string; contentType: string }): Promise<void>;
  status?: string | undefined;
}

/** Page state as table cells: strings as they are, anything else as JSON. */
function asText(state: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))]));
}

/** The `reader` fixture's body, given how to build a session. Taken as an argument so its tests need no reader. */
export function readerFixture(create: typeof createSession = createSession) {
  return async (
    { readerOptions, browser, browserName, channel, page, receipt }: ReaderFixtureArgs,
    use: (session: ReaderSession) => Promise<void>,
    testInfo: ReaderTestInfo,
  ): Promise<void> => {
    if (!readerOptions) {
      throw new Error("this project has no readerOptions: set use.readerOptions in its Playwright config");
    }
    const state = receipt?.state;
    const session = await create(readerOptions, { browserName, channel }, state ? { stateAfterStep: async () => asText(await page.evaluate(state)) } : {});
    // Playwright sets the test's status after the fixtures it ran; a start
    // that failed has not reached the test yet, so it is named here.
    let failure: unknown;
    try {
      // Inside the `try`: a start that fails has recorded every attempt and
      // its cause, and that record is the receipt a failed start leaves.
      await session.start();
      await use(session);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // Never throws, so it cannot mask the error that brought us here.
      await session.stop();
      // The durable record: what was asked, what was said, and what produced
      // it. Attached whatever the outcome, and kept by Playwright on failure.
      await testInfo.attach("reader-transcript", { body: session.transcript.join("\n"), contentType: "text/markdown" });
      const environment = await session.environment().catch((error: Error) => [`environment unavailable: ${error.message}`]);
      const stamp = environmentStamp(readerOptions.reader, environment, { name: channel ?? browserName, version: browser.version() });
      await testInfo.attach("environment", { body: stamp.join("\n"), contentType: "text/plain" });
      // A skipped test keeps the last run's file: it asked nothing this time.
      const outcome = failure === undefined ? testInfo.status : "failed";
      if (outcome !== "skipped") {
        writeReceiptFile(testInfo, { reader: session.reader, outcome: outcome ?? "passed", environment: stamp, steps: session.steps, transcript: session.transcript });
      }
    }
  };
}

/** The `reader` fixture and its option. `withReader` applies them with their types named. */
export const readerFixtures: ReaderFixtures = {
  readerOptions: [undefined, { option: true, scope: "worker" }],
  readerPreflight: [readerPreflight(), { scope: "worker", auto: true }],
  receipt: [undefined, { option: true }],
  reader: readerFixture(),
};

/**
 * The consumer's `test` with the `reader` fixture: `withReader(base)`, where
 * `base` is the consumer's own `test` from `@playwright/test`. Playwright's
 * `extend` cannot infer fixture types from an object it is handed, so
 * `base.extend(readerFixtures)` loses `reader` to the type checker; this names
 * them. The consumer's `base` is taken as an argument, so no second Playwright
 * is loaded.
 */
export function withReader(base: TestType<BaseTestArgs, BaseWorkerArgs>): TestType<BaseTestArgs & ReaderTestFixtures, BaseWorkerArgs & ReaderWorkerFixtures> {
  return base.extend<ReaderTestFixtures, ReaderWorkerFixtures>(readerFixtures);
}
