/**
 * Real local VoiceOver smoke proof. Run only from the supported interactive
 * macOS desktop after completing voiceover/README.md's one-time authorization.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { voiceOver } from "@guidepup/guidepup";
import { inspect } from "./doctor.ts";
import { resultFor, SUPPORTED } from "./evidence.ts";

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

mkdirSync(runDirectory, { recursive: true });
writeFileSync(join(runDirectory, "environment.json"), JSON.stringify(evidence, null, 2) + "\n");

try {
  if (!evidence.checks.every((check) => check.ok)) {
    throw new Error("Unsupported or incomplete environment; see environment.json.");
  }

  await voiceOver.start();
  started = true;
  await execFileAsync("open", ["-a", "Safari", fixtureUrl]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  // The fixture contains exactly one heading. Retrying lets Safari finish
  // placing the VoiceOver cursor in web content without weakening the proof.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await voiceOver.nextHeading();
    const phrases = await voiceOver.spokenPhraseLog();
    speech.splice(0, speech.length, ...phrases);
    if (phrases.some((phrase) => phrase.includes(SUPPORTED.heading))) break;
  }
} catch (error) {
  failure = error;
} finally {
  if (started) {
    try {
      speech.splice(0, speech.length, ...(await voiceOver.spokenPhraseLog()));
    } catch (error) {
      failure ??= error;
    }
    try {
      await voiceOver.stop();
    } catch (error) {
      failure ??= error;
    }
  }
  const result = resultFor(speech, failure);
  writeFileSync(join(runDirectory, "speech.json"), JSON.stringify(speech, null, 2) + "\n");
  writeFileSync(join(runDirectory, "result.json"), JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`${result.ok ? "VOICEOVER SMOKE OK" : "VOICEOVER SMOKE FAILED"} — ${runDirectory}`);
  process.exitCode = result.ok ? 0 : 1;
}
