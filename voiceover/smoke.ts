/**
 * Real local VoiceOver smoke proof. Run only after voiceover/README.md's
 * manual authorization. This file contains adapters; orchestration is tested
 * without invoking VoiceOver in orchestrator.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MacOSKeyCodes, macOSActivate, voiceOver } from "@guidepup/guidepup";
import { inspect } from "./doctor.ts";
import { containsFixtureToken, SUPPORTED, type CleanupOutcome, writeRunArtifacts } from "./evidence.ts";
import { launchWithRetry, runVoiceOverSmoke, type VoiceOverDriver } from "./orchestrator.ts";

const execFileAsync = promisify(execFile);
const runDirectory = join(import.meta.dirname, "..", "voiceover-runs", new Date().toISOString().replaceAll(":", "-"));
const fixtureUrl = pathToFileURL(join(import.meta.dirname, "fixture.html")).href;
const controller = new AbortController();
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let signalName: string | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    signalName = signal;
    controller.abort();
  });
}

/**
 * macOS 26 announces the Item Chooser only as a generic VoiceOver menu — it
 * never speaks the words "Item Chooser". Matching on the name alone spins
 * forever against a chooser that is already open. This also matches VoiceOver's
 * other menus, which is acceptable: landing in the wrong menu then fails in
 * `chooseWebContent` with the phrase VoiceOver actually spoke.
 */
const ITEM_CHOOSER_ANNOUNCEMENT = /item chooser|voiceover menu/i;
const CHOOSER_ATTEMPTS = 5;
const SEARCH_ATTEMPTS = 3;

async function openItemChooser(): Promise<void> {
  let spoken = "";
  for (let attempt = 0; attempt < CHOOSER_ATTEMPTS; attempt += 1) {
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
    await delay(100);
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Escape }, { capture: false });
    await delay(100);
    await voiceOver.perform(voiceOver.keyboardCommands.openItemChooser, { capture: true });
    spoken = await voiceOver.lastSpokenPhrase();
    if (ITEM_CHOOSER_ANNOUNCEMENT.test(spoken)) return;
  }
  throw new Error(`Item Chooser did not open in ${CHOOSER_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
}

async function chooseWebContent(): Promise<void> {
  let spoken = "";
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
    for (const character of "web content") {
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
      await delay(100);
      await voiceOver.type(character, { capture: "initial" });
      spoken = await voiceOver.lastSpokenPhrase();
      if (spoken.toLowerCase().includes("web content")) return;
    }
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Backspace }, { capture: false });
    await delay(100);
  }
  throw new Error(`Item Chooser had no Web Content entry after ${SEARCH_ATTEMPTS} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
}

async function enterSafariWebContent(): Promise<void> {
  // Guidepup Playwright's navigateToWebContent implementation uses these public
  // primitives: activate Safari, cancel, Item Chooser → Web Content, interact.
  // Do not substitute moveToNextWebSpot: it can land outside document content.
  // Every wait here is bounded: a stage timeout reports only elapsed time,
  // while these report what VoiceOver actually said.
  await macOSActivate("Safari");
  await openItemChooser();
  await chooseWebContent();
  await voiceOver.perform({ keyCode: MacOSKeyCodes.Enter }, { capture: false });
  await voiceOver.interact({ capture: false });
}

const startAttempts: CleanupOutcome[] = [];
const driver: VoiceOverDriver = {
  start: launchWithRetry(() => voiceOver.start({ capture: true }), () => voiceOver.stop(), startAttempts),
  stop: () => voiceOver.stop(),
  clearSpokenPhraseLog: () => voiceOver.clearSpokenPhraseLog(),
  clearItemTextLog: () => voiceOver.clearItemTextLog(),
  spokenPhraseLog: () => voiceOver.spokenPhraseLog(),
  itemText: () => voiceOver.itemText(),
  enterSafariWebContent,
  nextHeading: () => voiceOver.nextHeading(),
};
const evidence = {
  startedAt: new Date().toISOString(),
  fixture: fixtureUrl,
  supported: { macOS: "26.6.x", safari: "26.6.x", voiceOver: "bundled", guidepup: SUPPORTED.guidepup },
  checks: inspect(),
};

let speech: string[] = [];
let cursor: string[] = [];
let cleanup: CleanupOutcome[] = [];
let failure: unknown;
let stage = "preflight";
if (!evidence.checks.every((check) => check.ok)) {
  failure = new Error("Unsupported or incomplete environment; see environment.json.");
} else {
  const observation = await runVoiceOverSmoke(driver, {
    timeoutMs: 30_000,
    // Guidepup's own start operation performs two terminate/start attempts.
    // It needs a longer budget than individual navigation operations.
    startTimeoutMs: 150_000,
    // Item Chooser discovery is a sequence of VoiceOver commands, not a single
    // operation. Its own attempt limits are the real bound; this is a backstop
    // against a VoiceOver command that never returns at all.
    webContentTimeoutMs: 150_000,
    openFixture: () => execFileAsync("open", ["-a", "Safari", fixtureUrl]).then(() => undefined),
    waitForSafari: () => new Promise((resolve) => setTimeout(resolve, 1_500)),
    matchesFixture: containsFixtureToken,
    signal: controller.signal,
  });
  ({ speech, cursor, cleanup } = observation);
  failure = observation.failure ?? (signalName ? new Error(`Smoke interrupted by ${signalName}`) : undefined);
  stage = observation.failedStage ?? "complete";
}
const result = writeRunArtifacts(runDirectory, { ...evidence, startAttempts }, speech, cursor, failure, stage, cleanup);
console.log(`${result.ok ? "VOICEOVER SMOKE OK" : "VOICEOVER SMOKE FAILED"} — ${runDirectory}`);
process.exitCode = result.ok ? 0 : 1;
