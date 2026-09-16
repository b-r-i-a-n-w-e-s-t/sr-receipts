/**
 * Read-only prerequisite check for the narrow local VoiceOver smoke target.
 * It deliberately does not invoke Guidepup setup or alter macOS permissions.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { checkExact, checkVersion, SUPPORTED, type Check } from "./evidence.ts";

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

export function inspect(): Check[] {
  const safari = "/Applications/Safari.app";
  const safariVersion = existsSync(safari)
    ? command("mdls", ["-name", "kMDItemVersion", "-raw", safari]).replaceAll('"', "")
    : "not installed";
  const languages = command("defaults", ["read", "-g", "AppleLanguages"]);

  return [
    checkExact("platform", process.platform, "darwin"),
    checkVersion("macOS", command("sw_vers", ["-productVersion"]), SUPPORTED.macOS),
    checkExact("bundled VoiceOver", existsSync("/System/Library/CoreServices/VoiceOver.app") ? "present" : "missing", "present"),
    checkVersion("Safari", safariVersion, SUPPORTED.safari),
    checkExact("Guidepup", packageVersion(), SUPPORTED.guidepup),
    { name: "English language", actual: languages, expected: "AppleLanguages contains en", ok: /\ben\b/i.test(languages) },
  ];
}

export function writeDoctorReport(checks: Check[], output = join(import.meta.dirname, "doctor.json")): void {
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
