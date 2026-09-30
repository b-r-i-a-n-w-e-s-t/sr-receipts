/** What the doctor records about its checks, and the release family it checks against. */

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

export function checkExact(name: string, actual: string, expected: string): DoctorCheck {
  return { name, actual, expected, ok: actual === expected };
}

export function checkVersion(name: string, actual: string, expected: RegExp): DoctorCheck {
  return { name, actual, expected: expected.source, ok: expected.test(actual) };
}
