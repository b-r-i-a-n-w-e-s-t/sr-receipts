/**
 * VoiceOver as a `ReaderSession`, in process on this Mac.
 *
 * `createVoiceOverSession` builds the one reader interface a test sees, and
 * `createReaderSession` gives it the Transcript, the serialization and the
 * error contract every reader shares. Everything VoiceOver needs that NVDA
 * does not is settled in this file, so nothing above it knows it:
 *
 * - The start runs the doctor's checks and the permission probe first, and
 *   retries the launch race only, recording every attempt. See `start`.
 * - A sentinel is spoken before every command, so silence and repeated
 *   announcements are recorded as what they are. See "Speech" below.
 * - VoiceOver's hints are turned off, and any that get through are stripped
 *   from what is answered, because whether one is captured is a race. See
 *   "Speech" below.
 * - The Entry is the Item Chooser walk in `entry.ts`, given the steps it
 *   sends from here, without the sentinel: they are menu navigation, not
 *   answers a test reads, and the sentinel costs seconds.
 *
 * The browser is whatever Playwright launched for the project (its WebKit,
 * or a branded Chrome), never Safari. Its application name is what
 * VoiceOver's activation needs, and the fixture passes it. Must be reached
 * from a terminal holding the manual authorization in this package's
 * `README.md`.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { MacOSKeyCodes, macOSActivate, voiceOver } from "@guidepup/guidepup";
import { createReaderSession, errorChain, type ReaderAdapter, type ReaderSession } from "@sr-receipts/host";
import { delay as wait, packageVersion } from "./system.ts";
import { inspect, type DoctorCheck } from "./doctor.ts";
import { enterWebContent, type ItemChooser, type VoiceOverKey } from "./entry.ts";
import { automationProblems as askAutomationProblems } from "./permissions.ts";

const execFileAsync = promisify(execFile);

/**
 * Merged into Guidepup's portable preferences before VoiceOver starts. Hints
 * are off because each one arrives as a second phrase about a second after
 * the announcement, restarting Guidepup's wait for speech to settle, and they
 * are stripped from what is recorded anyway. The key comes from VoiceOver's
 * framework strings, not documentation; see this package's `README.md`.
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

/* ------------------------------------------------------------------ speech */

/*
 * A sentinel phrase spoken before every step, so that what VoiceOver said in
 * answer to the step can be told from what it said before.
 *
 * Guidepup reads VoiceOver's `last phrase` and decides a step's speech is new
 * by comparing it with the phrase it recorded last. That cannot distinguish two
 * cases, and on 2026-09-19 four runs in a row showed both:
 *
 * - **Silence.** A key bound to nothing was recorded as the previous step's
 *   announcement again, because `last phrase` still held it.
 * - **A repeat.** Asked to describe one cell twice, the second answer was
 *   dropped for equalling the first, and only the description VoiceOver spoke
 *   afterwards was kept.
 *
 * Speaking a known phrase first, through VoiceOver's own `output` command,
 * makes `last phrase` something no page ever says. A silent step then leaves
 * the sentinel in place and is recorded as it, which becomes silence once the
 * sentinel is stripped; a repeated announcement differs from the sentinel and
 * is recorded whole.
 *
 * Guidepup notices the sentinel on its own: it is a new phrase to the next
 * command's polling, so a silent command records only the sentinel, and a
 * spoken one records the sentinel joined to the announcement with ". ".
 *
 * The sentinel used to be followed by a captured press of Control, to cut it
 * short and put it in Guidepup's log. On 2026-09-26, under Playwright's
 * WebKit, that press made VoiceOver drop the next announcement: a live region
 * announced by a page action and every typed character were recorded as the
 * sentinel alone. With the `output` command alone, or with no sentinel, the
 * page action's announcement was heard; with the press alone it was not.
 * Why the press has that effect was not established.
 */

/** Words no page says, and VoiceOver reads as words rather than letters. */
export const SENTINEL = "receipts mark";

const LEADING_SENTINEL = new RegExp(`^${SENTINEL}(?:\\. |$)`);

/** Have VoiceOver speak the sentinel. */
async function speakSentinel(): Promise<void> {
  await execFileAsync("osascript", ["-e", `tell application "VoiceOver" to output ${JSON.stringify(SENTINEL)}`]);
}

/** The sentinel, and the ". " Guidepup joins it on with, taken off the front. */
const stripSentinel = (phrase: string): string => phrase.replace(LEADING_SENTINEL, "");

/*
 * VoiceOver's hints, and taking them out of recorded speech.
 *
 * After announcing an item VoiceOver pauses and then reads a hint: "You are
 * currently on a cell, inside of a table. To navigate the cells within this
 * table press Control-Option, and then…". Guidepup joins it to the announcement
 * with ". ", because to its polling the hint is just a later phrase.
 *
 * Whether the hint is caught depends on whether it started before Guidepup
 * decided the announcement was finished, and that is a race. On 2026-09-19 two
 * runs moved to the same cell by the same keys, and one recorded the hint and
 * the other did not. An exact snapshot cannot survive that, so the hint goes.
 *
 * What is lost is small. A hint restates the role the announcement already
 * gave, plus instructions that come from VoiceOver's verbosity setting rather
 * than from the page. The session says in its environment stamp that hints
 * were stripped, so a transcript never looks more complete than it is.
 *
 * Two consequences to know about:
 *
 * - A capture that was *only* a hint becomes empty, and is recorded as silence.
 * - Page text that itself says "You are currently on…" or "You are currently
 *   in…" is cut from there. Nothing can tell it from a hint, since both arrive
 *   as speech.
 */
const HINT = /(?:\. )?You are currently (?:on|in) [\s\S]*$/;

const stripHint = (phrase: string): string => phrase.replace(HINT, "");

/** The sentinel and the hints come off where speech is read, so every caller sees the same words. */
const clean = (phrase: string): string => stripHint(stripSentinel(phrase));

/* ----------------------------------------------------------------- session */

export interface VoiceOverSessionOptions {
  /** The browser's application name, as macOS knows it: "Playwright" for Playwright's WebKit. */
  applicationName: string;
}

/**
 * The session's internal seams, each defaulting to the real Mac. The tests
 * substitute them; nothing else does.
 */
export interface VoiceOverSeams {
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

/** The Environment Stamp. */
function stamp(): string[] {
  return [
    `macos: ${command("sw_vers", ["-productVersion"])} build ${command("sw_vers", ["-buildVersion"])} ${process.arch}`,
    "voiceover: bundled with macOS",
    `guidepup: ${packageVersion("@guidepup/guidepup")}`,
    `node: ${process.version}`,
    `voiceover settings: guidepup portable preferences with ${JSON.stringify(VOICEOVER_SETTINGS)}, capture=true, sentinel spoken before each command, hints stripped from recorded speech`,
  ];
}

function createVoiceOverAdapter(
  { applicationName }: VoiceOverSessionOptions,
  {
    reader = voiceOver as unknown as GuidepupVoiceOver,
    checks = inspect,
    automationProblems = askAutomationProblems,
    speakSentinel: sayMark = speakSentinel,
    activate = macOSActivate,
    delay = wait,
    environment = stamp,
    startAttempts = START_ATTEMPTS,
    startSettleMs = START_SETTLE_MS,
  }: VoiceOverSeams,
): ReaderAdapter {
  /** A command's answer: the last phrase, cleaned; silence when the sentinel is all that is left. */
  const said = async (action: () => Promise<void>): Promise<string> => {
    await sayMark();
    await action();
    return clean(await reader.lastSpokenPhrase());
  };

  /** One lone key, uncaptured, with the settle the next key needs. */
  const key = async (name: VoiceOverKey): Promise<void> => {
    await reader.perform({ keyCode: MacOSKeyCodes[name] }, { capture: false });
    await delay(KEY_SETTLE_MS);
  };

  // The Item Chooser's steps, each answering with VoiceOver's own words,
  // unstripped: the Entry matches on them, and no sentinel precedes them.
  const chooser: ItemChooser = {
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
  };

  return {
    reader: "voiceover",

    /**
     * Everything that can be known without the reader is checked first,
     * because a reader that is already talking has the keyboard. Then the
     * launch, retried on the race only, one line per attempt. A start that
     * fails leaves no reader running.
     */
    async start(record) {
      const missing = checks().filter((check) => !check.ok);
      if (missing.length) {
        throw new Error(
          `VoiceOver is not ready; see the @sr-receipts/voiceover README:\n  ${missing
            .map((check) => `${check.name}: ${check.actual} (expected ${check.expected})`)
            .join("\n  ")}`,
        );
      }
      const problems = await automationProblems();
      if (problems.length) {
        throw new Error(
          `this terminal may not drive the desktop, so VoiceOver was not started; see the @sr-receipts/voiceover README:\n  ${problems.join("\n  ")}`,
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

    enter: (page, _options, record) => enterWebContent({ activate, chooser }, page, { applicationName }, record),

    perform(name) {
      const keyCommand = reader.keyboardCommands[name];
      if (!keyCommand) throw new Error(`unknown VoiceOver keyboard command: ${name}`);
      return said(() => reader.perform(keyCommand));
    },
    press: (key) => said(() => reader.press(key)),
    next: () => said(() => reader.next()),
    previous: () => said(() => reader.previous()),

    async capture(action) {
      await sayMark();
      const captured = await reader.capture(action, { capture: true });
      return { result: captured.result, spoken: clean(captured.spokenPhrase) };
    },
    spokenPhraseLog: async () => (await reader.spokenPhraseLog()).map(clean),
    clearSpokenPhraseLog: () => reader.clearSpokenPhraseLog(),

    environment: async () => environment(),
  };
}

/** VoiceOver as the `ReaderSession` a test sees. `seams` is for the tests; a Mac needs only the options. */
export function createVoiceOverSession(options: VoiceOverSessionOptions, seams: VoiceOverSeams = {}): ReaderSession {
  return createReaderSession(createVoiceOverAdapter(options, seams));
}
