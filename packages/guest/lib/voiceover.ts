/**
 * The bundled VoiceOver on a local Mac, as a `ReaderSession`, driven in
 * process by the Playwright fixture. The sequencing lives here, behind
 * `VoiceOverDesktop`, so it is tested without a reader. Must be reached from
 * a terminal holding the manual authorization in `voiceover/README.md`.
 *
 * Where it differs from NVDA, and why:
 *
 * - There is no browse mode, so there are no mode probes. Arrival is proved by
 *   the Item Chooser sequence returning, which it does only once VoiceOver has
 *   spoken the Web Content entry, and by the first item having text.
 * - The browser is whatever Playwright launched for the project (its WebKit,
 *   or a branded Chrome), never Safari. Its application name is what
 *   VoiceOver's activation needs, and the fixture passes it.
 * - A sentinel is spoken before every command, so silence and repeated
 *   announcements are recorded as what they are. See `voiceover/sentinel.ts`.
 * - VoiceOver's hints are turned off, and any that get through are stripped
 *   from what is recorded, because whether one is captured is a race. See
 *   `voiceover/hints.ts`.
 * - The start is retried on the launch race only. See `voiceover/orchestrator.ts`.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { MacOSKeyCodes, macOSActivate, voiceOver } from "@guidepup/guidepup";
import { SILENCE, type Captured, type EntryPage, type ReaderSession } from "@sr-receipts/host";
import { inspect } from "../voiceover/doctor.ts";
import { errorChain, type DoctorCheck, type Outcome } from "../voiceover/evidence.ts";
import { stripHint } from "../voiceover/hints.ts";
import { launchWithRetry } from "../voiceover/orchestrator.ts";
import { automationProblems } from "../voiceover/permissions.ts";
import { speakSentinel, stripSentinel } from "../voiceover/sentinel.ts";
import { delay } from "./system.ts";

/**
 * Merged into Guidepup's portable preferences before VoiceOver starts. Hints
 * are off because each one arrives as a second phrase about a second after
 * the announcement, restarting Guidepup's wait for speech to settle, and they
 * are stripped from what is recorded anyway. The key comes from VoiceOver's
 * framework strings, not documentation; see `voiceover/README.md`.
 */
const VOICEOVER_SETTINGS = { SCRShouldOutputVOInstructions: false };

/** The lone keys the Item Chooser sequence sends. */
export type VoiceOverKey = "Control" | "Escape" | "Backspace" | "Enter";

/** The part of Guidepup's `voiceOver` the session drives. The seam the tests fake. */
export interface VoiceOverReader {
  readonly keyboardCommands: Readonly<Record<string, unknown>>;
  perform(command: unknown): Promise<void>;
  press(key: string): Promise<void>;
  /** One of the four lone keys, uncaptured. */
  key(name: VoiceOverKey): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** Type into the Item Chooser's search, capturing the first phrase. */
  type(text: string): Promise<void>;
  interact(): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  itemText(): Promise<string>;
  clearSpokenPhraseLog(): Promise<void>;
  clearItemTextLog(): Promise<void>;
  capture<T>(action: () => Promise<T>): Promise<{ spokenPhrase: string; result: T }>;
}

/** Everything the session asks of the real desktop. */
export interface VoiceOverDesktop {
  /** The doctor's read-only prerequisite checks. */
  checks(): DoctorCheck[];
  /** Why this process cannot drive the desktop; empty when it can. */
  automationProblems(): Promise<string[]>;
  reader: VoiceOverReader;
  /** Start the reader, appending every attempt to `attempts`. */
  start(attempts: Outcome[]): Promise<void>;
  stop(): Promise<void>;
  /** Spoken before every command; see `voiceover/sentinel.ts`. */
  speakSentinel(): Promise<void>;
  /** Bring the browser application to the front. */
  activate(applicationName: string): Promise<void>;
  delay(milliseconds: number): Promise<void>;
  environment(): string[];
}

export interface VoiceOverSessionOptions {
  /** The browser's application name, as macOS knows it: "Playwright" for Playwright's WebKit. */
  applicationName: string;
}

const require = createRequire(import.meta.url);

/**
 * The marker functions below run in the browser, through `page.evaluate`,
 * where `document` exists. This package is typechecked against Node's
 * library only, so the two members they use are declared here.
 */
declare const document: {
  body: { prepend(node: unknown): void };
  createElement(tag: string): Record<string, unknown> & { style: { cssText: string }; setAttribute(name: string, value: string): void };
  querySelector(selector: string): { remove(): void } | null;
};

function command(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function environment(): string[] {
  const guidepup = require("@guidepup/guidepup/package.json") as { version: string };
  return [
    `macos: ${command("sw_vers", ["-productVersion"])} build ${command("sw_vers", ["-buildVersion"])} ${process.arch}`,
    "voiceover: bundled with macOS",
    `guidepup: ${guidepup.version}`,
    `node: ${process.version}`,
    `voiceover settings: guidepup portable preferences with ${JSON.stringify(VOICEOVER_SETTINGS)}, capture=true, sentinel spoken before each command, hints stripped from recorded speech`,
  ];
}

const realDesktop: VoiceOverDesktop = {
  checks: inspect,
  automationProblems,
  reader: {
    get keyboardCommands() {
      return voiceOver.keyboardCommands;
    },
    perform: (keyCommand) => voiceOver.perform(keyCommand as Parameters<typeof voiceOver.perform>[0]),
    press: (key) => voiceOver.press(key),
    key: (name) => voiceOver.perform({ keyCode: MacOSKeyCodes[name] }, { capture: false }),
    next: () => voiceOver.next(),
    previous: () => voiceOver.previous(),
    type: (text) => voiceOver.type(text, { capture: "initial" }),
    interact: () => voiceOver.interact({ capture: false }),
    lastSpokenPhrase: () => voiceOver.lastSpokenPhrase(),
    spokenPhraseLog: () => voiceOver.spokenPhraseLog(),
    itemText: () => voiceOver.itemText(),
    clearSpokenPhraseLog: () => voiceOver.clearSpokenPhraseLog(),
    clearItemTextLog: () => voiceOver.clearItemTextLog(),
    capture: (action) => voiceOver.capture(action, { capture: true }),
  },
  start: (attempts) =>
    launchWithRetry(() => voiceOver.start({ capture: true, settings: VOICEOVER_SETTINGS }), () => voiceOver.stop(), attempts)(),
  stop: () => voiceOver.stop(),
  speakSentinel,
  activate: (applicationName) => macOSActivate(applicationName),
  delay,
  environment,
};

/**
 * How VoiceOver says the Item Chooser opened. On macOS 26 it usually speaks
 * only the highlighted entry, "On item <name>", and never the words "Item
 * Chooser"; the "VoiceOver Menu" this used to match was in the hint that
 * follows, which is off. Matching on the name alone spins forever against a
 * chooser that is already open. This also matches VoiceOver's other menus,
 * which is acceptable: landing in the wrong menu then fails in the search
 * with the phrase VoiceOver actually spoke.
 */
const ITEM_CHOOSER_ANNOUNCEMENT = /item chooser|voiceover menu|^on item /i;
const CHOOSER_ATTEMPTS = 10;
const SEARCH_ATTEMPTS = 5;

/** The sentinel and the hints come off where speech is read, so every caller sees the same words. */
const clean = (phrase: string): string => stripHint(stripSentinel(phrase));

export function createVoiceOverSession({ applicationName }: VoiceOverSessionOptions, desktop: VoiceOverDesktop = realDesktop): ReaderSession {
  const { reader } = desktop;
  const transcript: string[] = [];

  /** A command's answer: the last phrase, cleaned; silence when the sentinel is all that is left. */
  const said = async (label: string, action: () => Promise<void>): Promise<string> => {
    await desktop.speakSentinel();
    await action();
    const spoken = clean(await reader.lastSpokenPhrase());
    transcript.push(`${label}: ${spoken || SILENCE}`);
    return spoken;
  };

  /**
   * The web content entry: the stock @guidepup/playwright sequence, with
   * bounds on both loops, which the stock ones lack. The marker input is the
   * stock trick that makes VoiceOver notice later Playwright interactions.
   */
  async function enter(page: EntryPage): Promise<string> {
    await desktop.activate(applicationName);
    await reader.key("Control");
    await desktop.delay(100);
    await page.bringToFront();
    await page.evaluate(() => {
      const marker = document.createElement("input");
      marker.id = "__guidepup_marker__";
      marker.type = "text";
      marker.value = "Guidepup Marker";
      marker.readOnly = true;
      marker.tabIndex = -1;
      marker.autocomplete = "off";
      marker.setAttribute("aria-label", "Guidepup Marker");
      marker.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
      document.body.prepend(marker);
    });
    try {
      let spoken = "";
      for (let attempt = 1; ; attempt++) {
        await reader.key("Control");
        await desktop.delay(100);
        await reader.key("Escape");
        await desktop.delay(100);
        await reader.perform(reader.keyboardCommands.openItemChooser);
        spoken = await reader.lastSpokenPhrase();
        transcript.push(`open item chooser (attempt ${attempt}): ${spoken || SILENCE}`);
        if (ITEM_CHOOSER_ANNOUNCEMENT.test(spoken)) break;
        if (attempt >= CHOOSER_ATTEMPTS) {
          throw new Error(`Item Chooser did not open in ${CHOOSER_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
        }
      }
      let matched = false;
      for (let round = 1; round <= SEARCH_ATTEMPTS && !matched; round++) {
        for (const character of "web content") {
          await reader.key("Control");
          await desktop.delay(100);
          await reader.type(character);
          spoken = await reader.lastSpokenPhrase();
          if (spoken.toLowerCase().includes("web content")) {
            matched = true;
            break;
          }
        }
        transcript.push(`item chooser search (round ${round}): ${spoken || SILENCE}`);
        if (!matched) {
          await reader.key("Backspace");
          await desktop.delay(100);
        }
      }
      if (!matched) {
        throw new Error(`Item Chooser had no Web Content entry after ${SEARCH_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
      }
      await reader.key("Enter");
      await reader.interact();
      await desktop.delay(100);
      await reader.clearSpokenPhraseLog();
      await reader.clearItemTextLog();
      await reader.next();
      const arrivedOn = clean(await reader.itemText());
      transcript.push(`### focus guard: VoiceOver cursor in the web content, on ${JSON.stringify(arrivedOn)}`);
      if (!arrivedOn) throw new Error("entered web content, but the first item has no text");
      return arrivedOn;
    } finally {
      await page.evaluate(() => document.querySelector("#__guidepup_marker__")?.remove()).catch(() => undefined);
    }
  }

  return {
    reader: "voiceover",
    transcript,

    async start() {
      // Everything that can be known without the reader is asked before it
      // starts, because a reader that is already talking has the keyboard.
      const missing = desktop.checks().filter((check) => !check.ok);
      if (missing.length) {
        throw new Error(
          `VoiceOver is not ready; see packages/guest/voiceover/README.md:\n  ${missing
            .map((check) => `${check.name}: ${check.actual} (expected ${check.expected})`)
            .join("\n  ")}`,
        );
      }
      const problems = await desktop.automationProblems();
      if (problems.length) {
        throw new Error(
          `this terminal may not drive the desktop, so VoiceOver was not started; see packages/guest/voiceover/README.md:\n  ${problems.join("\n  ")}`,
        );
      }
      const attempts: Outcome[] = [];
      try {
        await desktop.start(attempts);
      } catch (error) {
        // A half-started VoiceOver would trip the next test.
        await desktop.stop().catch(() => undefined);
        throw error;
      } finally {
        // One line per attempt: a start that needed a retry says so instead
        // of passing silently. An AppleScript error arrives with newlines.
        for (const attempt of attempts) {
          transcript.push(`${attempt.action}: ${attempt.ok ? "ok" : (attempt.error ?? "failed").replace(/\s*\n\s*/g, " ").trim()}`);
        }
      }
    },

    async stop() {
      try {
        await desktop.stop();
      } catch (error) {
        transcript.push(`stop VoiceOver: ${errorChain(error).join(" <- ")}`);
      }
    },

    async enter(page) {
      try {
        return await enter(page);
      } catch (error) {
        transcript.push("### WEB CONTENT NOT REACHED", errorChain(error).join(" <- "));
        throw new Error(`VoiceOver did not reach the web content:\n${transcript.join("\n")}`, { cause: error });
      }
    },

    perform: (name) => {
      const keyCommand = reader.keyboardCommands[name];
      if (!keyCommand) throw new Error(`unknown VoiceOver keyboard command: ${name}`);
      return said(name, () => reader.perform(keyCommand));
    },
    press: (key) => said(`press ${key}`, () => reader.press(key)),
    next: () => said("next", () => reader.next()),
    previous: () => said("previous", () => reader.previous()),

    async capture<T>(action: () => Promise<T>): Promise<Captured<T>> {
      await desktop.speakSentinel();
      const captured = await reader.capture(action);
      const spoken = clean(captured.spokenPhrase);
      transcript.push(`page action: ${spoken || SILENCE}`);
      return { result: captured.result, spoken };
    },

    spokenPhraseLog: async () => (await reader.spokenPhraseLog()).map(clean),
    clearSpokenPhraseLog: () => reader.clearSpokenPhraseLog(),
    environment: async () => desktop.environment(),
  };
}
