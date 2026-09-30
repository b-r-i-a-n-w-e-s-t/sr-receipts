/**
 * VoiceOver on this Mac: the desktop the session drives, behind a seam the
 * tests fake. The shape is `NvdaDesktop`'s: one of Guidepup's actions answers
 * with what the reader said, `""` for silence, and everything VoiceOver needs
 * that NVDA does not is settled here, so nothing above this file knows it.
 *
 * - A sentinel is spoken before every command, so silence and repeated
 *   announcements are recorded as what they are. See `sentinel.ts`.
 * - VoiceOver's hints are turned off, and any that get through are stripped
 *   from what is answered, because whether one is captured is a race. See
 *   `hints.ts`.
 * - The start is retried on the launch race only, and every attempt is
 *   recorded. See `start` below.
 * - The Item Chooser's steps are here without the sentinel: they are menu
 *   navigation, not answers a test reads, and the sentinel costs seconds.
 *
 * Must be reached from a terminal holding the manual authorization in
 * `README.md` beside this file.
 */
import { execFileSync } from "node:child_process";
import { MacOSKeyCodes, macOSActivate, voiceOver } from "@guidepup/guidepup";
import { errorChain, type Captured, type Recorder } from "@sr-receipts/host";
import { delay as wait, packageVersion } from "../lib/system.ts";
import { inspect } from "./doctor.ts";
import type { DoctorCheck } from "./evidence.ts";
import { stripHint } from "./hints.ts";
import { automationProblems as askAutomationProblems } from "./permissions.ts";
import { speakSentinel as sayMark, stripSentinel } from "./sentinel.ts";

/**
 * Merged into Guidepup's portable preferences before VoiceOver starts. Hints
 * are off because each one arrives as a second phrase about a second after
 * the announcement, restarting Guidepup's wait for speech to settle, and they
 * are stripped from what is recorded anyway. The key comes from VoiceOver's
 * framework strings, not documentation; see `README.md` beside this file.
 */
export const VOICEOVER_SETTINGS = { SCRShouldOutputVOInstructions: false };

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
/** What a lone key needs before the next one lands. */
const KEY_SETTLE_MS = 100;

export function isLaunchRace(error: unknown): boolean {
  return errorChain(error).some((message) => LAUNCH_RACE.test(message));
}

/**
 * The part of Guidepup's `voiceOver` this file drives. Narrower than
 * Guidepup's own type on purpose: it is the whole seam the unit tests
 * substitute.
 */
export interface GuidepupVoiceOver {
  readonly keyboardCommands: Readonly<Record<string, unknown>>;
  start(options?: unknown): Promise<void>;
  stop(): Promise<void>;
  perform(command: unknown, options?: unknown): Promise<void>;
  press(key: string): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  type(text: string, options?: unknown): Promise<void>;
  interact(options?: unknown): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  itemText(): Promise<string>;
  clearSpokenPhraseLog(): Promise<void>;
  clearItemTextLog(): Promise<void>;
  capture<T>(action: () => Promise<T>, options?: unknown): Promise<{ spokenPhrase: string; result: T }>;
}

/** The lone keys the Item Chooser sequence sends. */
export type VoiceOverKey = "Control" | "Escape" | "Backspace" | "Enter";

/**
 * The Item Chooser, which the web content entry walks. Each step returns what
 * VoiceOver said as it happened, unstripped: the entry matches on it, and no
 * sentinel precedes it.
 */
export interface ItemChooser {
  /** One lone key, uncaptured, with the settle the next key needs. */
  key(name: VoiceOverKey): Promise<void>;
  /** Stop speech, dismiss any menu, open the chooser; what VoiceOver said as it opened. */
  open(): Promise<string>;
  /** Type one character into the chooser's search; what VoiceOver said. */
  type(character: string): Promise<string>;
  /** Choose the highlighted entry and interact with it. */
  choose(): Promise<void>;
  /** With the logs cleared, move to the first item inside and return its text. */
  firstItem(): Promise<string>;
}

/** Everything the session and the entry ask of the desktop. Its methods are called unbound. */
export interface VoiceOverDesktop {
  /**
   * Start the reader, recording one line per attempt so a start that needed
   * a retry says so. Everything that can be known without the reader is
   * checked first, because a reader that is already talking has the keyboard.
   * A start that fails leaves no reader running.
   */
  start(record: Recorder): Promise<void>;
  stop(): Promise<void>;
  /** Bring the browser application to the front. */
  activate(applicationName: string): Promise<void>;
  /** One of VoiceOver's commands by Guidepup's name for it; what it made VoiceOver say, "" for silence. */
  perform(command: string): Promise<string>;
  press(key: string): Promise<string>;
  next(): Promise<string>;
  previous(): Promise<string>;
  /** Run a page action inside the reader's speech window; what it made VoiceOver say. */
  capture<T>(action: () => Promise<T>): Promise<Captured<T>>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  chooser: ItemChooser;
  /** The Environment Stamp. */
  environment(): string[];
}

export interface VoiceOverDesktopOptions {
  reader?: GuidepupVoiceOver;
  /** The doctor's read-only prerequisite checks. */
  checks?: () => DoctorCheck[];
  /** Why this process cannot drive the desktop; empty when it can. */
  automationProblems?: () => Promise<string[]>;
  speakSentinel?: () => Promise<void>;
  activate?: (applicationName: string) => Promise<void>;
  delay?: (milliseconds: number) => Promise<void>;
  environment?: () => string[];
  startAttempts?: number;
  startSettleMs?: number;
}

function command(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function stamp(): string[] {
  return [
    `macos: ${command("sw_vers", ["-productVersion"])} build ${command("sw_vers", ["-buildVersion"])} ${process.arch}`,
    "voiceover: bundled with macOS",
    `guidepup: ${packageVersion("@guidepup/guidepup")}`,
    `node: ${process.version}`,
    `voiceover settings: guidepup portable preferences with ${JSON.stringify(VOICEOVER_SETTINGS)}, capture=true, sentinel spoken before each command, hints stripped from recorded speech`,
  ];
}

/** The sentinel and the hints come off where speech is read, so every caller sees the same words. */
const clean = (phrase: string): string => stripHint(stripSentinel(phrase));

export function createVoiceOverDesktop({
  reader = voiceOver as unknown as GuidepupVoiceOver,
  checks = inspect,
  automationProblems = askAutomationProblems,
  speakSentinel = sayMark,
  activate = macOSActivate,
  delay = wait,
  environment = stamp,
  startAttempts = START_ATTEMPTS,
  startSettleMs = START_SETTLE_MS,
}: VoiceOverDesktopOptions = {}): VoiceOverDesktop {
  /** A command's answer: the last phrase, cleaned; silence when the sentinel is all that is left. */
  const said = async (action: () => Promise<void>): Promise<string> => {
    await speakSentinel();
    await action();
    return clean(await reader.lastSpokenPhrase());
  };

  const key = async (name: VoiceOverKey): Promise<void> => {
    await reader.perform({ keyCode: MacOSKeyCodes[name] }, { capture: false });
    await delay(KEY_SETTLE_MS);
  };

  return {
    async start(record) {
      const missing = checks().filter((check) => !check.ok);
      if (missing.length) {
        throw new Error(
          `VoiceOver is not ready; see packages/guest/voiceover/README.md:\n  ${missing
            .map((check) => `${check.name}: ${check.actual} (expected ${check.expected})`)
            .join("\n  ")}`,
        );
      }
      const problems = await automationProblems();
      if (problems.length) {
        throw new Error(
          `this terminal may not drive the desktop, so VoiceOver was not started; see packages/guest/voiceover/README.md:\n  ${problems.join("\n  ")}`,
        );
      }
      // Only the launch race is retried. Anything else fails on the first
      // attempt: a passing result has to mean VoiceOver really was driven, so
      // this must not paper over a reader that cannot start at all.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await reader.start({ capture: true, settings: VOICEOVER_SETTINGS });
          record(`start VoiceOver (attempt ${attempt}): ok`);
          return;
        } catch (error) {
          // An AppleScript error arrives with newlines.
          record(`start VoiceOver (attempt ${attempt}): ${errorChain(error).join(" <- ").replace(/\s*\n\s*/g, " ").trim()}`);
          // A lost race can still leave a half-launched reader behind, and
          // the next attempt, or the next test, needs it gone.
          await reader.stop().catch(() => undefined);
          if (attempt >= startAttempts || !isLaunchRace(error)) throw error;
          await delay(startSettleMs);
        }
      }
    },
    stop: () => reader.stop(),
    activate,

    perform(name) {
      const keyCommand = reader.keyboardCommands[name];
      if (!keyCommand) throw new Error(`unknown VoiceOver keyboard command: ${name}`);
      return said(() => reader.perform(keyCommand));
    },
    press: (key) => said(() => reader.press(key)),
    next: () => said(() => reader.next()),
    previous: () => said(() => reader.previous()),

    async capture(action) {
      await speakSentinel();
      const captured = await reader.capture(action, { capture: true });
      return { result: captured.result, spoken: clean(captured.spokenPhrase) };
    },
    spokenPhraseLog: async () => (await reader.spokenPhraseLog()).map(clean),
    clearSpokenPhraseLog: () => reader.clearSpokenPhraseLog(),

    chooser: {
      key,
      async open() {
        await key("Control");
        await key("Escape");
        await reader.perform(reader.keyboardCommands.openItemChooser);
        return reader.lastSpokenPhrase();
      },
      async type(character) {
        await key("Control");
        await reader.type(character, { capture: "initial" });
        return reader.lastSpokenPhrase();
      },
      async choose() {
        await key("Enter");
        await reader.interact({ capture: false });
        await delay(KEY_SETTLE_MS);
      },
      async firstItem() {
        await reader.clearSpokenPhraseLog();
        await reader.clearItemTextLog();
        await reader.next();
        return clean(await reader.itemText());
      },
    },

    environment,
  };
}
