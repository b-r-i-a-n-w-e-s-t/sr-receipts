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
import { createNvdaSession, type Reader, type ReaderSession } from "@sr-receipts/host";

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
  createVoiceOverSession(options: { applicationName: string }): ReaderSession;
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
  load?: () => Promise<VoiceOverPackage>,
): Promise<ReaderSession> {
  if (options.reader === "nvda") return createNvdaSession({ url: options.url, token: options.token });
  const { createVoiceOverSession } = await loadVoiceOver(load);
  return createVoiceOverSession({ applicationName: options.applicationName ?? applicationNameFor(browser.browserName, browser.channel) });
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

type ReaderTestFixtures = { reader: ReaderSession };
type ReaderWorkerFixtures = { readerOptions: ReaderOptions | undefined };
type BaseTestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type BaseWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

type ReaderFixtures = Fixtures<ReaderTestFixtures, ReaderWorkerFixtures, BaseTestArgs, BaseWorkerArgs>;

/** What the fixture's body needs from Playwright's own fixtures and `testInfo`. */
interface ReaderFixtureArgs {
  readerOptions: ReaderOptions | undefined;
  browser: { version(): string };
  browserName: string;
  channel: string | undefined;
}
interface Attachments {
  attach(name: string, options: { body: string; contentType: string }): Promise<void>;
}

/** The `reader` fixture's body, given how to build a session. Taken as an argument so its tests need no reader. */
export function readerFixture(create: typeof createSession = createSession) {
  return async (
    { readerOptions, browser, browserName, channel }: ReaderFixtureArgs,
    use: (session: ReaderSession) => Promise<void>,
    testInfo: Attachments,
  ): Promise<void> => {
    if (!readerOptions) {
      throw new Error("this project has no readerOptions: set use.readerOptions in its Playwright config");
    }
    const session = await create(readerOptions, { browserName, channel });
    await session.start();
    try {
      await use(session);
    } finally {
      await session.stop();
      // The durable record: what was asked, what was said, and what produced
      // it. Attached whatever the outcome, and kept by Playwright on failure.
      await testInfo.attach("reader-transcript", { body: session.transcript.join("\n"), contentType: "text/markdown" });
      const environment = await session.environment().catch((error: Error) => [`environment unavailable: ${error.message}`]);
      const stamp = environmentStamp(readerOptions.reader, environment, { name: channel ?? browserName, version: browser.version() });
      await testInfo.attach("environment", { body: stamp.join("\n"), contentType: "text/plain" });
    }
  };
}

/** The `reader` fixture and its option. `withReader` applies them with their types named. */
export const readerFixtures: ReaderFixtures = {
  readerOptions: [undefined, { option: true, scope: "worker" }],
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
