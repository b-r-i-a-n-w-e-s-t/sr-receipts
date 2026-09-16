import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SUPPORTED = {
  guidepup: "0.34.0",
  macOS: /^26\.6(?:\.\d+)?$/,
  safari: /^26\.6(?:\.\d+)?$/,
  voiceOverAsset: {
    platformVersion: "25",
    version: "0.0.1-VoiceOver4",
    file: "guidepup-voiceover-preferences-macos-26.dmg",
  },
  heading: "Dogwalk VoiceOver smoke heading: Marigold Comet 48291",
} as const;

export type Check = {
  name: string;
  actual: string;
  expected: string;
  ok: boolean;
};

export type SmokeResult = {
  ok: boolean;
  error?: string;
  limitation?: string;
  stage?: string;
  causes?: string[];
  heading: string;
  speech: string[];
};

export function checkExact(name: string, actual: string, expected: string): Check {
  return { name, actual, expected, ok: actual === expected };
}

export function checkVersion(
  name: string,
  actual: string,
  expected: RegExp,
): Check {
  return { name, actual, expected: expected.source, ok: expected.test(actual) };
}

export function resultFor(
  speech: string[],
  error?: unknown,
  stage?: string,
): SmokeResult {
  const causes = errorChain(error);
  const errorMessage = causes[0];
  const ok = !errorMessage && speech.length > 0 && speech.some((phrase) => phrase.includes(SUPPORTED.heading));
  return {
    ok,
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(stage ? { stage } : {}),
    ...(causes.length ? { causes } : {}),
    ...(!ok ? {
      limitation: `${stage ?? "completion"}: Guidepup could not prove VoiceOver control and captured speech for the supported Safari fixture.`,
    } : {}),
    heading: SUPPORTED.heading,
    speech,
  };
}

export function errorChain(error: unknown): string[] {
  const causes: string[] = [];
  let current = error;
  while (current) {
    if (current instanceof Error) {
      causes.push(current.message);
      current = current.cause;
    } else {
      causes.push(String(current));
      break;
    }
  }
  return causes;
}

export function writeRunArtifacts(
  directory: string,
  environment: object,
  speech: string[],
  failure: unknown,
  stage: string,
): SmokeResult {
  mkdirSync(directory, { recursive: true });
  const result = resultFor(speech, failure, stage);
  writeFileSync(join(directory, "environment.json"), JSON.stringify({ ...environment, stage }, null, 2) + "\n");
  writeFileSync(join(directory, "speech.json"), JSON.stringify(speech, null, 2) + "\n");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2) + "\n");
  return result;
}
