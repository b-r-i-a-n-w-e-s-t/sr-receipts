import type { CleanupOutcome } from "./evidence.ts";

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

  try {
    checkAbort();
    currentStage = "start VoiceOver";
    startPromise = driver.start();
    try {
      await timed(currentStage, options.timeoutMs, () => startPromise!, options.signal);
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
    await timed(currentStage, options.timeoutMs, driver.enterSafariWebContent, options.signal);
    for (let attempt = 0; attempt < 3 && !options.matchesFixture([...speech, ...cursor]); attempt += 1) {
      checkAbort();
      currentStage = "find fixture heading";
      await timed(currentStage, options.timeoutMs, driver.nextHeading, options.signal);
      currentStage = "capture heading evidence";
      await timed(currentStage, options.timeoutMs, capture, options.signal);
    }
    if (!options.matchesFixture(speech) || !options.matchesFixture(cursor)) {
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
  return { speech, cursor, failure, failedStage, cleanup };
}
