/**
 * Minimal reproduction of the Guidepup VoiceOver capture failure.
 *
 * `voiceover/smoke.ts` fails while entering Safari web content, which hides the
 * actual defect: after a successful `start({ capture: true })`, phrase and
 * cursor queries come back empty and Guidepup surfaces the VoiceOver
 * AppleScript error `Can't get content of last phrase. (-1728)`. This probe
 * strips Safari, the fixture, and the Item Chooser away so the only surface
 * left is start -> one reader command -> capture query.
 *
 * Every reading is recorded rather than thrown, so a single run shows whether
 * capture never worked or broke once the reader moved. Orchestration is pure
 * and unit tested; real VoiceOver is reached only through the adapter below.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { voiceOver } from "@guidepup/guidepup";
import { inspect } from "./doctor.ts";
import { errorChain, type Outcome } from "./evidence.ts";

export type CaptureProbeDriver = {
  start(): Promise<void>;
  stop(): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  itemText(): Promise<string>;
  next(): Promise<void>;
  /** Reads VoiceOver's scripting dictionary without going through Guidepup. */
  runAppleScript(source: string): Promise<string>;
};

/**
 * The exact scripts Guidepup 0.34.0 runs for `lastSpokenPhrase()` and
 * `itemText()`, plus an existence check for the object the failing one
 * references. Running them directly separates "Guidepup's wrapper swallows the
 * result" from "VoiceOver exposes no `last phrase` object to script at all":
 * Guidepup's client polls these and discards errors, so only the raw reading
 * shows the AppleScript error itself.
 */
export const VOICEOVER_SCRIPTS = [
  { name: "content of last phrase", source: 'tell application "VoiceOver"\nreturn content of last phrase\nend tell' },
  { name: "exists last phrase", source: 'tell application "VoiceOver"\nreturn exists last phrase\nend tell' },
  { name: "text under cursor of vo cursor", source: 'tell application "VoiceOver"\nreturn text under cursor of vo cursor\nend tell' },
] as const;

/** One capture reading: its value, or the error the reader raised instead. */
export type Reading<T> = { ok: true; value: T } | { ok: false; error: string };

/** The three capture surfaces, queried together at one point in the run. */
export type CaptureQuery = {
  /** The action the probe had just completed when this query ran. */
  after: string;
  lastSpokenPhrase: Reading<string>;
  spokenPhraseLog: Reading<string[]>;
  itemText: Reading<string>;
  scripts: { name: string; result: Reading<string> }[];
};

export type CaptureProbeReport = {
  actions: Outcome[];
  queries: CaptureQuery[];
  cleanup: Outcome[];
};

async function read<T>(action: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: errorChain(error).join(" <- ") };
  }
}

async function outcomeOf(action: string, run: () => Promise<unknown>): Promise<Outcome> {
  const reading = await read(run);
  return reading.ok ? { action, ok: true } : { action, ok: false, error: reading.error };
}

export async function probeCapture(driver: CaptureProbeDriver): Promise<CaptureProbeReport> {
  const actions: Outcome[] = [];
  const queries: CaptureQuery[] = [];
  const cleanup: Outcome[] = [];

  const attempt = async (action: string, run: () => Promise<unknown>): Promise<boolean> => {
    const outcome = await outcomeOf(action, run);
    actions.push(outcome);
    return outcome.ok;
  };
  const query = async (after: string): Promise<void> => {
    const scripts: { name: string; result: Reading<string> }[] = [];
    for (const script of VOICEOVER_SCRIPTS) {
      scripts.push({ name: script.name, result: await read(() => driver.runAppleScript(script.source)) });
    }
    queries.push({
      after,
      lastSpokenPhrase: await read(() => driver.lastSpokenPhrase()),
      spokenPhraseLog: await read(() => driver.spokenPhraseLog()),
      itemText: await read(() => driver.itemText()),
      scripts,
    });
  };

  try {
    if (await attempt("start VoiceOver with capture", () => driver.start())) {
      // Before any navigation: separates "capture never works" from "capture
      // breaks once the reader moves".
      await query("start VoiceOver with capture");
      await attempt("clear spoken phrase log", () => driver.clearSpokenPhraseLog());
      await query("clear spoken phrase log");
      await attempt("move the VoiceOver cursor to the next item", () => driver.next());
      await query("move the VoiceOver cursor to the next item");
    }
  } finally {
    // Always attempt a stop: Guidepup's start terminates and restarts
    // VoiceOver, so even a failed start can leave it running.
    cleanup.push(await outcomeOf("stop VoiceOver", () => driver.stop()));
  }
  return { actions, queries, cleanup };
}

/** Guidepup's error messages carry asset paths under the user's home. */
export function redactHome(text: string, home = homedir()): string {
  return home ? text.replaceAll(home, "~") : text;
}

if (process.argv[1] === import.meta.filename) {
  const execFileAsync = promisify(execFile);
  const driver: CaptureProbeDriver = {
    start: () => voiceOver.start({ capture: true }),
    stop: () => voiceOver.stop(),
    clearSpokenPhraseLog: () => voiceOver.clearSpokenPhraseLog(),
    lastSpokenPhrase: () => voiceOver.lastSpokenPhrase(),
    spokenPhraseLog: () => voiceOver.spokenPhraseLog(),
    itemText: () => voiceOver.itemText(),
    next: () => voiceOver.next(),
    runAppleScript: (source) => execFileAsync("osascript", ["-e", source]).then(({ stdout }) => stdout.trim()),
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    // An interrupt must not leave VoiceOver speaking on the maintainer's desktop.
    process.once(signal, () => {
      void voiceOver.stop().finally(() => process.exit(1));
    });
  }

  const report = await probeCapture(driver);
  const checks = inspect().filter((check) => !check.ok).map((check) => check.name);
  console.log(redactHome(JSON.stringify({ ...report, failedChecks: checks }, null, 2)));
  const captured = report.queries.some(
    (query) => query.spokenPhraseLog.ok && query.spokenPhraseLog.value.some((phrase) => phrase.trim() !== ""),
  );
  console.log(captured ? "CAPTURE PROBE: speech observed" : "CAPTURE PROBE: no speech captured");
  process.exitCode = captured ? 0 : 1;
}
