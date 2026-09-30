import { errorChain } from "@sr-receipts/host";
import type { Outcome } from "./evidence.ts";

/**
 * Guidepup terminates and restarts VoiceOver inside `start()`, and can activate
 * it before macOS has finished launching it: AppleScript `-600`. Upstream
 * issue #113 (formerly #101) reports related not-fully-quitting behaviour on
 * Tahoe. Roughly one start in seven failed this way in the pivot's proof of
 * concept, before any capture happened.
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
 * Every attempt is appended to `record`, including the successful one, so a
 * test that needed a retry still says so in its transcript instead of passing
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
