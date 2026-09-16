export const SUPPORTED = {
  guidepup: "0.34.0",
  macOS: /^26\.6\.\d+$/,
  safari: /^26\.6\.\d+$/,
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
): SmokeResult {
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined;
  const ok = !errorMessage && speech.length > 0 && speech.some((phrase) => phrase.includes(SUPPORTED.heading));
  return {
    ok,
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(!ok ? {
      limitation: "Guidepup could not prove VoiceOver control and captured speech for the supported Safari fixture.",
    } : {}),
    heading: SUPPORTED.heading,
    speech,
  };
}
