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
import { runVoiceOverSmoke, type VoiceOverDriver } from "./orchestrator.ts";

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

async function enterSafariWebContent(): Promise<void> {
  // Guidepup Playwright's navigateToWebContent implementation uses these public
  // primitives: activate Safari, cancel, Item Chooser → Web Content, interact.
  // Do not substitute moveToNextWebSpot: it can land outside document content.
  await macOSActivate("Safari");
  await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
  await delay(100);
  await voiceOver.perform({ keyCode: MacOSKeyCodes.Escape }, { capture: false });
  await delay(100);
  await voiceOver.perform(voiceOver.keyboardCommands.openItemChooser, { capture: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const character of "web content") {
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }, { capture: false });
      await delay(100);
      await voiceOver.type(character, { capture: "initial" });
      if ((await voiceOver.lastSpokenPhrase()).toLocaleLowerCase("en-US").includes("web content")) {
        await voiceOver.perform({ keyCode: MacOSKeyCodes.Enter }, { capture: false });
        await voiceOver.interact({ capture: false });
        return;
      }
    }
    await voiceOver.perform({ keyCode: MacOSKeyCodes.Backspace }, { capture: false });
    await delay(100);
  }
  throw new Error("VoiceOver Item Chooser did not select Web Content");
}

const driver: VoiceOverDriver = {
  start: () => voiceOver.start({ capture: true }),
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
    openFixture: () => execFileAsync("open", ["-a", "Safari", fixtureUrl]).then(() => undefined),
    waitForSafari: () => new Promise((resolve) => setTimeout(resolve, 1_500)),
    matchesFixture: containsFixtureToken,
    signal: controller.signal,
  });
  ({ speech, cursor, cleanup } = observation);
  failure = observation.failure ?? (signalName ? new Error(`Smoke interrupted by ${signalName}`) : undefined);
  stage = observation.failedStage ?? "complete";
}
const result = writeRunArtifacts(runDirectory, evidence, speech, cursor, failure, stage, cleanup);
console.log(`${result.ok ? "VOICEOVER SMOKE OK" : "VOICEOVER SMOKE FAILED"} — ${runDirectory}`);
process.exitCode = result.ok ? 0 : 1;
