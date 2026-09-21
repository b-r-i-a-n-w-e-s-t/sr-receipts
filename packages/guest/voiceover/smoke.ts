/**
 * Real local VoiceOver smoke proof. Run only after voiceover/README.md's
 * manual authorization. This file contains adapters; orchestration is tested
 * without invoking VoiceOver in orchestrator.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { voiceOver } from "@guidepup/guidepup";
import { inspect } from "./doctor.ts";
import { containsFixtureToken, SUPPORTED, type CleanupOutcome, writeRunArtifacts } from "./evidence.ts";
import { launchWithRetry, runVoiceOverSmoke, type VoiceOverDriver } from "./orchestrator.ts";
import { enterSafariWebContent } from "./safari.ts";

const execFileAsync = promisify(execFile);
const runDirectory = join(import.meta.dirname, "..", "voiceover-runs", new Date().toISOString().replaceAll(":", "-"));
const fixtureUrl = pathToFileURL(join(import.meta.dirname, "fixture.html")).href;
const controller = new AbortController();
let signalName: string | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    signalName = signal;
    controller.abort();
  });
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
