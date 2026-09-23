/**
 * Read-only prerequisite check for the narrow local VoiceOver smoke target.
 * It deliberately does not invoke Guidepup setup or alter macOS permissions.
 */
import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { checkExact, checkVersion, SUPPORTED, type DoctorCheck } from "./evidence.ts";

const require = createRequire(import.meta.url);

function command(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return `unavailable: ${(error as Error).message}`;
  }
}

function packageVersion(): string {
  try {
    return (require("@guidepup/guidepup/package.json") as { version: string }).version;
  } catch {
    return "not installed";
  }
}

export function expectedVoiceOverAsset(cache = process.env.GUIDEPUP_SCREEN_READERS_PATH ?? join(homedir(), "Library", "Caches", "guidepup")): string {
  return join(cache, "voiceover", SUPPORTED.voiceOverAsset.platformVersion,
    SUPPORTED.voiceOverAsset.version, SUPPORTED.voiceOverAsset.file);
}

/** Sequoia moved VoiceOver's preferences here, out of reach of `defaults`. */
export function voiceOverPreferenceDirectory(home = homedir()): string {
  return join(home, "Library", "Group Containers", "group.com.apple.VoiceOver", "Library", "Preferences");
}

/**
 * VoiceOver's own scripting dictionary is gated on this preference. Without it
 * Guidepup still starts, stops, and sends keystrokes, because those go through
 * System Events rather than VoiceOver — but every VoiceOver dictionary message
 * fails, property reads with AppleScript `-1728` and commands with `-1708`. So
 * `lastSpokenPhrase()`, `spokenPhraseLog()`, and `itemText()` come back empty
 * while control looks healthy. That combination is the whole failure, so check
 * it before a run rather than diagnosing it afterwards.
 */
export function appleScriptControlCheck(plist = join(voiceOverPreferenceDirectory(), "com.apple.VoiceOver4", "default.plist")): DoctorCheck {
  const actual = existsSync(plist)
    ? command("plutil", ["-extract", "SCREnableAppleScript", "raw", "-o", "-", plist])
    : `no VoiceOver preferences at ${plist}`;
  return {
    name: "VoiceOver AppleScript control",
    actual,
    expected: "true (VoiceOver Utility → General → Allow VoiceOver to be controlled with AppleScript)",
    ok: actual === "true",
  };
}

export function preferenceAccessCheck(path: string): DoctorCheck {
  try {
    // Guidepup mounts portable preferences and updates the local plist here.
    // This access check is non-mutating, unlike the smoke's eventual use.
    accessSync(path, constants.R_OK | constants.W_OK);
    return { name: "VoiceOver preferences access", actual: `${path}: readable and writable`, expected: "readable and writable", ok: true };
  } catch (error) {
    return { name: "VoiceOver preferences access", actual: `${path}: ${(error as Error).message}`, expected: "readable and writable", ok: false };
  }
}

export function inspect(): DoctorCheck[] {
  const safari = "/Applications/Safari.app";
  const safariVersion = existsSync(safari)
    ? command("mdls", ["-name", "kMDItemVersion", "-raw", safari]).replaceAll('"', "")
    : "not installed";
  const languages = command("defaults", ["read", "-g", "AppleLanguages"]);
  const groupPreferences = voiceOverPreferenceDirectory();
  const preferences = existsSync(groupPreferences)
    ? groupPreferences : join(homedir(), "Library", "Preferences");

  return [
    checkExact("platform", process.platform, "darwin"),
    checkVersion("macOS", command("sw_vers", ["-productVersion"]), SUPPORTED.macOS),
    checkExact("bundled VoiceOver", existsSync("/System/Library/CoreServices/VoiceOver.app") ? "present" : "missing", "present"),
    checkVersion("Safari", safariVersion, SUPPORTED.safari),
    checkExact("Guidepup", packageVersion(), SUPPORTED.guidepup),
    checkExact("Guidepup VoiceOver asset", existsSync(expectedVoiceOverAsset()) ? "present" : "missing", "present"),
    preferenceAccessCheck(preferences),
    appleScriptControlCheck(),
    { name: "English language", actual: languages, expected: "AppleLanguages contains en", ok: /\ben\b/i.test(languages) },
  ];
}

export function writeDoctorReport(checks: DoctorCheck[], output = join(import.meta.dirname, "doctor.json")): void {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
}

if (process.argv[1] === import.meta.filename) {
  const checks = inspect();
  writeDoctorReport(checks);
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "MISSING"} ${check.name}: ${check.actual}`);
  }
  console.log("Wrote voiceover/doctor.json");
  if (!checks.every((check) => check.ok)) {
    console.log("This read-only check cannot prove Accessibility or Automation authorization.");
    process.exitCode = 1;
  }
}
