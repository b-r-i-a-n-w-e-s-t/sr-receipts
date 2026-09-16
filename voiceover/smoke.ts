/**
 * Real local VoiceOver smoke proof. Run only from the supported interactive
 * macOS desktop after completing voiceover/README.md's one-time authorization.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { voiceOver } from "@guidepup/guidepup";
import { inspect } from "./doctor.ts";
import { resultFor, SUPPORTED, writeRunArtifacts } from "./evidence.ts";

const execFileAsync = promisify(execFile);
const runDirectory = join(import.meta.dirname, "..", "voiceover-runs", new Date().toISOString().replaceAll(":", "-"));
const fixture = join(import.meta.dirname, "fixture.html");
const fixtureUrl = pathToFileURL(fixture).href;
const evidence = {
  startedAt: new Date().toISOString(),
  fixture: fixtureUrl,
  supported: {
    macOS: "26.6.x",
    safari: "26.6.x",
    voiceOver: "bundled",
    guidepup: SUPPORTED.guidepup,
  },
  checks: inspect(),
};
const speech: string[] = [];
let started = false;
let failure: unknown;
let stage = "preflight";
const STAGE_TIMEOUT_MS = 30_000;

async function withinStage<T>(name: string, action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} timed out after ${STAGE_TIMEOUT_MS / 1_000}s`)),
          STAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function persist(): void {
  writeRunArtifacts(runDirectory, evidence, speech, failure, stage);
}
persist();

// SIGINT/SIGTERM cannot safely await Guidepup cleanup. Preserve the evidence
// collected so far; Guidepup also registers its own best-effort teardown.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stage = `interrupted (${signal})`;
    failure ??= new Error(`Smoke interrupted by ${signal}`);
    persist();
    process.exitCode = 1;
  });
}

try {
  if (!evidence.checks.every((check) => check.ok)) {
    throw new Error("Unsupported or incomplete environment; see environment.json.");
  }

  stage = "start VoiceOver";
  await withinStage(stage, voiceOver.start({ capture: true }));
  started = true;
  await voiceOver.clearSpokenPhraseLog();
  stage = "open Safari fixture";
  await withinStage(stage, execFileAsync("open", ["-a", "Safari", fixtureUrl]));
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  // Enter Safari's document before asking for a heading. nextHeading alone can
  // navigate VoiceOver's desktop/browser chrome context instead of this page.
  stage = "enter Safari web content";
  await withinStage(stage, voiceOver.perform(voiceOver.keyboardCommands.moveToNextWebSpot));
  stage = "find fixture heading";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await withinStage(stage, voiceOver.nextHeading());
    const phrases = await withinStage(stage, voiceOver.spokenPhraseLog());
    speech.splice(0, speech.length, ...phrases);
    if (phrases.some((phrase) => phrase.includes(SUPPORTED.heading))) break;
  }
} catch (error) {
  failure = error;
} finally {
  if (started) {
    try {
      stage = "capture speech";
      speech.splice(0, speech.length, ...(await voiceOver.spokenPhraseLog()));
    } catch (error) {
      failure ??= error;
    }
    try {
      stage = "stop VoiceOver";
      await voiceOver.stop();
    } catch (error) {
      failure ??= error;
    }
  }
  stage = failure ? stage : "complete";
  persist();
  const result = resultFor(speech, failure, stage);
  console.log(`${result.ok ? "VOICEOVER SMOKE OK" : "VOICEOVER SMOKE FAILED"} — ${runDirectory}`);
  process.exitCode = result.ok ? 0 : 1;
}
