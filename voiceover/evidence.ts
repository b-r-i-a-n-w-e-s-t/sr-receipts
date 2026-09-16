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
  fixtureToken: "MarigoldComet48291",
  heading: "Dogwalk VoiceOver smoke heading: MarigoldComet48291",
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
  cleanup: CleanupOutcome[];
  heading: string;
  fixtureToken: string;
  speech: string[];
  cursor: string[];
};

export type CleanupOutcome = {
  action: string;
  ok: boolean;
  error?: string;
};

/** Compare reader output independently of punctuation, spacing, and case. */
export function normalizeVoiceOverText(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

export function containsFixtureToken(values: string[]): boolean {
  const token = normalizeVoiceOverText(SUPPORTED.fixtureToken);
  return values.some((value) => normalizeVoiceOverText(value).includes(token));
}

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
  cursor: string[] = [],
  cleanup: CleanupOutcome[] = [],
): SmokeResult {
  const causes = errorChain(error);
  const errorMessage = causes[0];
  const cleanupFailure = cleanup.find((outcome) => !outcome.ok);
  const ok = !errorMessage && !cleanupFailure && containsFixtureToken(speech) && containsFixtureToken(cursor);
  const cleanupMessage = cleanupFailure?.error;
  return {
    ok,
    ...(errorMessage ? { error: errorMessage } : cleanupMessage ? { error: cleanupMessage } : {}),
    ...(stage ? { stage } : {}),
    ...(causes.length ? { causes } : {}),
    ...(!ok ? {
      limitation: `${stage ?? "completion"}: Guidepup could not prove VoiceOver control, normalized fixture-token speech, and cursor position for the supported Safari fixture.`,
    } : {}),
    heading: SUPPORTED.heading,
    fixtureToken: SUPPORTED.fixtureToken,
    speech,
    cursor,
    cleanup,
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
  cursor: string[],
  failure: unknown,
  stage: string,
  cleanup: CleanupOutcome[] = [],
): SmokeResult {
  mkdirSync(directory, { recursive: true });
  const result = resultFor(speech, failure, stage, cursor, cleanup);
  writeFileSync(join(directory, "environment.json"), JSON.stringify({ ...environment, stage }, null, 2) + "\n");
  writeFileSync(join(directory, "speech.json"), JSON.stringify(speech, null, 2) + "\n");
  writeFileSync(join(directory, "cursor.json"), JSON.stringify(cursor, null, 2) + "\n");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2) + "\n");
  return result;
}
