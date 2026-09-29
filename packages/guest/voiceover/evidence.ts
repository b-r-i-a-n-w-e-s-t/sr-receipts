/** What the doctor and the VoiceOver session record about their checks and attempts. */

export const SUPPORTED = {
  guidepup: "0.34.0",
  macOS: /^26\.6(?:\.\d+)?$/,
  voiceOverAsset: {
    platformVersion: "25",
    version: "0.0.1-VoiceOver4",
    file: "guidepup-voiceover-preferences-macos-26.dmg",
  },
} as const;

export type DoctorCheck = {
  name: string;
  actual: string;
  expected: string;
  ok: boolean;
};

/** An attempted action and whether it succeeded. */
export type Outcome = {
  action: string;
  ok: boolean;
  error?: string;
};

export function checkExact(name: string, actual: string, expected: string): DoctorCheck {
  return { name, actual, expected, ok: actual === expected };
}

export function checkVersion(name: string, actual: string, expected: RegExp): DoctorCheck {
  return { name, actual, expected: expected.source, ok: expected.test(actual) };
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
