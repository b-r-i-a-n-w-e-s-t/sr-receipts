import { errorChain, type CleanupOutcome, type Outcome } from "./evidence.ts";

export type VoiceOverDriver = {
  start(): Promise<void>;
  stop(): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
  clearItemTextLog(): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  itemText(): Promise<string>;
  enterSafariWebContent(): Promise<void>;
  nextHeading(): Promise<void>;
};

/**
 * Guidepup terminates and restarts VoiceOver inside `start()`, and can activate
 * it before macOS has finished launching it — AppleScript `-600`. Upstream issue
 * #101 reports related not-fully-quitting behavior on Tahoe. Roughly one run in
 * four failed this way before any capture happened.
 */
const LAUNCH_RACE = /application isn'?t running|\(-600\)/i;
/**
 * Five, from three: on 2026-09-19 two runs in about ten reached the third
 * attempt before the reader came up, and one more lost race in either would
 * have broken the run.
 */
export const START_ATTEMPTS = 5;
/** Retrying immediately never recovered the race; a later run always did. */
export const START_SETTLE_MS = 10_000;

export function isLaunchRace(error: unknown): boolean {
  return errorChain(error).some((message) => LAUNCH_RACE.test(message));
}

/**
 * Wraps a reader launch so that only the launch race is retried. Anything else
 * fails on the first attempt: a passing result has to mean VoiceOver really was
 * driven, so this must not paper over a reader that cannot start at all.
 *
 * Every attempt is appended to `record`, including the successful one, so a run
 * that needed a retry still says so in its artifacts instead of passing
 * silently.
 */
export function launchWithRetry(
  start: () => Promise<void>,
  stop: () => Promise<void>,
  record: Outcome[],
  options: {
    limit?: number;
    settleMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): () => Promise<void> {
  const limit = options.limit ?? START_ATTEMPTS;
  const settleMs = options.settleMs ?? START_SETTLE_MS;
  const wait = options.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  return async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await start();
        record.push({ action: `start VoiceOver (attempt ${attempt})`, ok: true });
        return;
      } catch (error) {
        record.push({ action: `start VoiceOver (attempt ${attempt})`, ok: false, error: errorChain(error).join(" <- ") });
        if (attempt >= limit || !isLaunchRace(error)) throw error;
        // A lost race can still leave a half-launched reader behind, and the
        // next attempt needs macOS to finish tearing it down.
        await stop().catch(() => undefined);
        await wait(settleMs);
      }
    }
  };
}

export type SmokeObservation = {
  speech: string[];
  cursor: string[];
  failure?: unknown;
  /** Never overwritten by cleanup: this identifies where the run first failed. */
  failedStage?: string;
  cleanup: CleanupOutcome[];
};

export type SmokeOptions = {
  timeoutMs: number;
  startTimeoutMs?: number;
  webContentTimeoutMs?: number;
  openFixture(): Promise<void>;
  waitForSafari(): Promise<void>;
  matchesFixture(values: string[]): boolean;
  signal?: AbortSignal;
};

export class StageTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs / 1_000}s`);
  }
}

export class SmokeInterruptedError extends Error {
  constructor() {
    super("Smoke interrupted by signal");
  }
}

async function timed<T>(
  stage: string,
  timeoutMs: number,
  action: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StageTimeoutError(stage, timeoutMs)), timeoutMs);
      }),
      new Promise<T>((_, reject) => {
        abort = () => reject(new SmokeInterruptedError());
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

/**
 * Runs only observable reader operations. The caller supplies OS-specific
 * primitives, which lets tests prove sequencing without starting VoiceOver.
 */
export async function runVoiceOverSmoke(driver: VoiceOverDriver, options: SmokeOptions): Promise<SmokeObservation> {
  const speech: string[] = [];
  const cursor: string[] = [];
  const cleanup: CleanupOutcome[] = [];
  let failure: unknown;
  let failedStage: string | undefined;
  let startPromise: Promise<void> | undefined;
  let started = false;
  let currentStage = "preflight";

  const fail = (stage: string, error: unknown) => {
    failure ??= error;
    failedStage ??= stage;
  };
  const checkAbort = () => {
    if (options.signal?.aborted) throw new Error("Smoke interrupted by signal");
  };
  const capture = async () => {
    speech.splice(0, speech.length, ...(await driver.spokenPhraseLog()));
    cursor.push(await driver.itemText());
  };
  /** The run's success condition: the token reached speech *and* the cursor. */
  const proven = () => options.matchesFixture(speech) && options.matchesFixture(cursor);

  try {
    checkAbort();
    currentStage = "start VoiceOver";
    startPromise = driver.start();
    try {
      await timed(currentStage, options.startTimeoutMs ?? options.timeoutMs, () => startPromise!, options.signal);
      started = true;
    } catch (error) {
      // A start call can finish after its timeout. Stop it then, rather than
      // leaving a late-started VoiceOver process running.
      startPromise.then(
        () => driver.stop().catch(() => undefined),
        () => undefined,
      );
      throw error;
    }
    currentStage = "clear VoiceOver logs";
    await timed(currentStage, options.timeoutMs, async () => {
      await driver.clearSpokenPhraseLog();
      await driver.clearItemTextLog();
    }, options.signal);
    checkAbort();
    currentStage = "open Safari fixture";
    await timed(currentStage, options.timeoutMs, options.openFixture, options.signal);
    currentStage = "wait for Safari fixture";
    await timed(currentStage, options.timeoutMs, options.waitForSafari, options.signal);
    checkAbort();
    currentStage = "enter Safari web content";
    await timed(currentStage, options.webContentTimeoutMs ?? options.timeoutMs, driver.enterSafariWebContent, options.signal);
    // Navigate until the proof itself holds. Stopping as soon as *either*
    // stream matched let the Item Chooser's own announcement — which speaks the
    // heading being chosen, and so contains the token — end navigation with the
    // cursor still outside the heading.
    for (let attempt = 0; attempt < 3 && !proven(); attempt += 1) {
      checkAbort();
      currentStage = "find fixture heading";
      await timed(currentStage, options.timeoutMs, driver.nextHeading, options.signal);
      currentStage = "capture heading evidence";
      await timed(currentStage, options.timeoutMs, capture, options.signal);
    }
    if (!proven()) {
      throw new Error("Fixture token was not observed in both spoken output and VoiceOver cursor text");
    }
  } catch (error) {
    const stage = error instanceof StageTimeoutError ? error.message.replace(/ timed out.*$/, "") : undefined;
    fail(stage ?? (options.signal?.aborted ? "interrupted" : currentStage), error);
  } finally {
    if (started || startPromise) {
      try {
        await timed("capture cleanup evidence", options.timeoutMs, capture);
        cleanup.push({ action: "capture speech and cursor evidence", ok: true });
      } catch (error) {
        cleanup.push({ action: "capture speech and cursor evidence", ok: false, error: String(error) });
      }
      try {
        await timed("stop VoiceOver", options.timeoutMs, driver.stop);
        cleanup.push({ action: "stop VoiceOver", ok: true });
      } catch (error) {
        cleanup.push({ action: "stop VoiceOver", ok: false, error: String(error) });
        // Cleanup failures must not conceal the original failed stage.
        if (!failure) fail("stop VoiceOver", error);
      }
    }
  }
  return {
    speech,
    cursor,
    failure,
    ...(failedStage ? { failedStage } : {}),
    cleanup,
  };
}
