/**
 * NVDA with headed Firefox on the Windows Guest Rig, as an Execution Target.
 *
 * The sequencing lives in `session.ts` and `guard.ts`, where it was proven, and
 * reaches the desktop only through `WindowsDesktop`, so it is tested without a
 * reader. Must be reached from the interactive console session, for the reasons
 * `session.ts` gives.
 */
import { nvda, windowsActivate } from "@guidepup/guidepup";
import { requireReader, type ExecutionTarget } from "./execution-target.ts";
import { FIREFOX, ensureProfile, excludeAddressBar, launch } from "./firefox.ts";
import { validateModeProbes } from "./guard.ts";
import { openTarget, startSession, stopSession, watchFocus } from "./session.ts";
import type { SpeechLog, SpeechSource } from "./speech.ts";
import { stamp } from "./stamp.ts";
import { runSteps, validateSteps, type ReaderDriver } from "./steps.ts";
import { delay, taskkill, windowList } from "./system.ts";
import type { WindowSize } from "./types.ts";

/**
 * Everything the NVDA target asks of the Windows desktop. The seam the tests
 * fake. Its methods are called unbound, so an implementation must not rely on
 * `this`.
 */
export interface WindowsDesktop {
  reader: ReaderDriver & SpeechSource;
  startReader(): Promise<void>;
  stopReader(): Promise<void>;
  /** End every process with this image name, if any is running. */
  kill(image: string): void;
  /** Recreate the hermetic Firefox profile; see `lib/firefox.ts`. */
  ensureProfile(): void;
  /** Start Firefox on this URL, sized first when a size is given. */
  launch(url: string, window?: WindowSize): void;
  /** Bring Firefox's window to the foreground. */
  activateBrowser(): Promise<void>;
  /** Every window on screen, for a transcript that has to say what had focus. */
  windowList(): string;
  delay(milliseconds: number): Promise<void>;
  environment(): string[];
}

/**
 * `capture: true` keeps whole announcements; the default `"initial"` truncates
 * at the first phrase. The speechViewer override stops NVDA's own viewer window
 * from opening and taking focus away from the browser.
 */
export const NVDA_OPTIONS = {
  capture: true,
  settings: { speechViewer: { showSpeechViewerAtStartup: false } },
} as const;

const realDesktop: WindowsDesktop = {
  reader: nvda as unknown as ReaderDriver & SpeechSource,
  startReader: () => nvda.start(NVDA_OPTIONS),
  stopReader: () => nvda.stop(),
  kill: taskkill,
  ensureProfile,
  launch: (url, window) => {
    launch(url, { window });
  },
  activateBrowser: () => windowsActivate(FIREFOX, "Mozilla Firefox"),
  windowList,
  delay,
  environment: stamp,
};

export function createNvdaTarget(desktop: WindowsDesktop = realDesktop): ExecutionTarget {
  return {
    environment: desktop.environment,

    async start() {
      let speech: SpeechLog;
      try {
        speech = await startSession(desktop);
      } catch (error) {
        // A half-started NVDA or a stray Firefox would trip the next run.
        await stopSession(desktop);
        throw error;
      }
      const nvda = desktop.reader;
      return {
        validate: (scenario) => {
          requireReader(scenario, "nvda");
          validateSteps(nvda, scenario.steps);
          validateModeProbes(nvda, scenario.modeProbes);
        },
        open: (target, scenario) =>
          openTarget(desktop, speech, target, { modeProbes: scenario.modeProbes, window: scenario.window }),
        // Re-check every few steps that the keystrokes are still reaching the
        // page, so a stolen foreground stops the sequence instead of typing the
        // rest of it into somebody else's window.
        perform: async (scenario, onStep) => {
          const watch = watchFocus(
            desktop,
            speech,
            scenario.focusCheckEvery === undefined ? {} : { every: scenario.focusCheckEvery },
          );
          const result = await runSteps(nvda, speech, scenario.steps, { onStep, watch });
          return { ...result, steps: excludeAddressBar(result.steps) };
        },
        stop: () => stopSession(desktop),
      };
    },
  };
}

export const nvdaTarget: ExecutionTarget = createNvdaTarget();
