/**
 * The bundled VoiceOver with Safari on a local Mac, as an Execution Target.
 *
 * The sequencing lives here, behind `VoiceOverDesktop`, so it is tested without
 * a reader. The mechanics stay where they were proven: `voiceover/safari.ts`,
 * `voiceover/orchestrator.ts` and `voiceover/doctor.ts`. Must be reached from a
 * terminal holding the manual authorization in `voiceover/README.md`.
 *
 * Where it differs from the NVDA target, and why:
 *
 * - There is no browse mode, so there are no mode probes. Arrival is proved by
 *   the Item Chooser sequence returning, which it does only once VoiceOver has
 *   spoken the Web Content entry, and by Safari's front window being the run's
 *   own, showing the target.
 * - The focus watch asks System Events and Safari rather than the reader, so it
 *   costs no reader round trip and types nothing. It therefore runs after every
 *   step unless a scenario says otherwise. It cannot see the VoiceOver cursor
 *   leaving web content while Safari keeps the foreground.
 * - A sentinel is spoken before every step, so silence and repeated
 *   announcements are recorded as what they are. See `voiceover/sentinel.ts`.
 * - VoiceOver's hints are turned off, and any that get through are stripped
 *   from what is recorded, because whether one is captured is a race. See
 *   `voiceover/hints.ts`.
 * - Each target gets a Safari window of its own, closed by id, because this
 *   desktop is somebody's working machine and their Safari is not the run's to
 *   quit.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { voiceOver } from "@guidepup/guidepup";
import { requireReader, type ExecutionTarget } from "./execution-target.ts";
import { SpeechLog, type SpeechSource } from "./speech.ts";
import { runSteps, validateSteps } from "./steps.ts";
import { delay } from "./system.ts";
import { resolveTarget } from "./target.ts";
import type { FocusWatch, ReaderDriver } from "./steps.ts";
import type { WindowSize } from "./types.ts";
import { inspect } from "../voiceover/doctor.ts";
import { errorChain, type DoctorCheck, type Outcome } from "../voiceover/evidence.ts";
import { stripHint } from "../voiceover/hints.ts";
import { speakSentinel, stripSentinel } from "../voiceover/sentinel.ts";
import { launchWithRetry } from "../voiceover/orchestrator.ts";
import {
  automationProblems,
  closeSafariWindow,
  enterSafariWebContent,
  openSafariWindow,
  safariFront,
  type SafariFront,
} from "../voiceover/safari.ts";

/** Everything the target asks of the real desktop. The seam the tests fake. */
export interface VoiceOverDesktop {
  /** The doctor's read-only prerequisite checks. */
  checks(): DoctorCheck[];
  /** Why this process cannot drive the desktop; empty when it can. */
  automationProblems(): Promise<string[]>;
  reader: ReaderDriver & SpeechSource;
  /** Spoken before every step; see `voiceover/sentinel.ts`. */
  speakSentinel(): Promise<void>;
  /** Start the reader, appending every attempt to `attempts`. */
  startReader(attempts: Outcome[]): Promise<void>;
  stopReader(): Promise<void>;
  openWindow(url: string, size?: WindowSize): Promise<number>;
  enterWebContent(): Promise<void>;
  front(): Promise<SafariFront>;
  closeWindow(id: number): Promise<void>;
  delay(milliseconds: number): Promise<void>;
  environment(): string[];
}

const require = createRequire(import.meta.url);

function command(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Merged into Guidepup's portable preferences before VoiceOver starts. Hints
 * are off because each one arrives as a second phrase about a second after the
 * announcement, restarting Guidepup's wait for speech to settle, and they are
 * stripped from what the target records anyway. The key comes from VoiceOver's
 * framework strings, not documentation; see `voiceover/README.md`.
 */
const VOICEOVER_SETTINGS = { SCRShouldOutputVOInstructions: false };

function environment(): string[] {
  const guidepup = require("@guidepup/guidepup/package.json") as { version: string };
  return [
    `macos: ${command("sw_vers", ["-productVersion"])} build ${command("sw_vers", ["-buildVersion"])} ${process.arch}`,
    `safari: ${command("mdls", ["-name", "kMDItemVersion", "-raw", "/Applications/Safari.app"])}`,
    "voiceover: bundled with macOS",
    `guidepup: ${guidepup.version}`,
    `node: ${process.version}`,
    `voiceover settings: guidepup portable preferences with ${JSON.stringify(VOICEOVER_SETTINGS)}, capture=true, sentinel spoken before each step, hints stripped from recorded speech`,
  ];
}

const realDesktop: VoiceOverDesktop = {
  checks: inspect,
  automationProblems,
  reader: voiceOver as unknown as ReaderDriver & SpeechSource,
  speakSentinel,
  startReader: (attempts) =>
    launchWithRetry(() => voiceOver.start({ capture: true, settings: VOICEOVER_SETTINGS }), () => voiceOver.stop(), attempts)(),
  stopReader: () => voiceOver.stop(),
  openWindow: openSafariWindow,
  enterWebContent: enterSafariWebContent,
  front: safariFront,
  closeWindow: closeSafariWindow,
  delay,
  environment,
};

/** `file:` URLs come back from Safari as they went in; anything else may gain a slash. */
const sameUrl = (a: string, b: string): boolean => a.replace(/\/$/, "") === b.replace(/\/$/, "");

export function createVoiceOverTarget(desktop: VoiceOverDesktop = realDesktop): ExecutionTarget {
  return {
    environment: desktop.environment,

    async start() {
      // Everything that can be known without the reader is asked before it
      // starts, because a reader that is already talking has the keyboard.
      const missing = desktop.checks().filter((check) => !check.ok);
      if (missing.length) {
        throw new Error(
          `VoiceOver target is not ready; see voiceover/README.md:\n  ${missing
            .map((check) => `${check.name}: ${check.actual} (expected ${check.expected})`)
            .join("\n  ")}`,
        );
      }
      const problems = await desktop.automationProblems();
      if (problems.length) {
        throw new Error(
          `this terminal may not drive the desktop, so VoiceOver was not started; see voiceover/README.md:\n  ${problems.join("\n  ")}`,
        );
      }

      const attempts: Outcome[] = [];
      try {
        await desktop.startReader(attempts);
      } catch (error) {
        // A half-started VoiceOver would trip the next run.
        await desktop.stopReader().catch(() => undefined);
        throw error;
      }

      // The sentinel and the hints are taken out where the log is read, so
      // steps, expectations, snapshots and the stream all see the same words.
      const speech = new SpeechLog({
        spokenPhraseLog: async () =>
          (await desktop.reader.spokenPhraseLog()).map((phrase) => stripHint(stripSentinel(phrase))),
      });
      // Every step is preceded by the sentinel. `keyboardCommands` stays a
      // getter: guidepup's throws until the reader is running.
      const driver: ReaderDriver = {
        get keyboardCommands() {
          return desktop.reader.keyboardCommands;
        },
        async perform(command) {
          await desktop.speakSentinel();
          return desktop.reader.perform(command);
        },
        async press(key) {
          await desktop.speakSentinel();
          return desktop.reader.press(key);
        },
      };
      await speech.discard();
      let windowId: number | undefined;
      let disclosedStart = false;

      const closeWindow = async (): Promise<void> => {
        if (windowId === undefined) return;
        const id = windowId;
        windowId = undefined;
        await desktop.closeWindow(id).catch(() => undefined);
      };

      const watch = (every: number): FocusWatch => ({
        every,
        async check() {
          const front = await desktop.front();
          if (front.process !== "Safari") return front.process;
          return front.windowId === windowId ? null : `another Safari window (${front.url || "no document"})`;
        },
      });

      return {
        validate(scenario) {
          requireReader(scenario, "voiceover");
          validateSteps(driver, scenario.steps);
        },

        async open(entry, scenario) {
          const target = resolveTarget(entry);
          const lines: string[] = [];
          // Disclosed once, in the first transcript: a run that needed a retry
          // says so instead of passing silently. Kept out of `environment()`,
          // which a snapshot records, so a retry is not read as a changed rig.
          if (!disclosedStart) {
            disclosedStart = true;
            // One line per attempt: an AppleScript error arrives with newlines in it.
            const flat = (error?: string) => (error ?? "failed").replace(/\s*\n\s*/g, " ").trim();
            lines.push("### VoiceOver start", ...attempts.map((a) => `${a.action}: ${a.ok ? "ok" : flat(a.error)}`), "");
          }

          try {
            await closeWindow();
            windowId = await desktop.openWindow(target.url, scenario.window);
            await desktop.delay(target.settle);
            await desktop.enterWebContent();
          } catch (error) {
            lines.push("### WEB CONTENT NOT REACHED", errorChain(error).join(" <- "), "");
            return { ok: false, lines, target };
          }

          const front = await desktop.front();
          const arrived = front.process === "Safari" && front.windowId === windowId && sameUrl(front.url, target.url);
          lines.push(
            arrived
              ? "### focus guard: VoiceOver cursor in the web content of the run's own Safari window"
              : "### FOCUS GUARD FAILED",
            `frontmost: ${front.process}; Safari front window: ${front.windowId ?? "none"} showing ${front.url || "nothing"}`,
            `expected: window ${windowId} showing ${target.url}`,
            "",
          );
          if (!arrived) return { ok: false, lines, target };

          await speech.discard();
          return { ok: true, lines, target };
        },

        perform: (scenario, onStep) =>
          runSteps(driver, speech, scenario.steps, { onStep, watch: watch(scenario.focusCheckEvery ?? 1) }),

        /** Never throws: a failed teardown must not mask the error that caused it. */
        async stop() {
          await desktop.stopReader().catch(() => undefined);
          await closeWindow();
        },
      };
    },
  };
}

export const voiceOverTarget: ExecutionTarget = createVoiceOverTarget();
