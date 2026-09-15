/**
 * Guest-OS odds and ends: sleeping, killing processes, asking Windows about
 * itself, and hashing bytes the way git does.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Blunt but reliable: a half-dead Firefox is what froze the guest once. */
export function taskkill(image: string): void {
  try {
    execFileSync("taskkill", ["/F", "/IM", image], { stdio: "ignore" });
  } catch {
    // nothing to kill
  }
}

/**
 * Returns "unknown" rather than throwing, because every caller is collecting
 * provenance for a transcript and a missing line is better than a lost run.
 */
export function powershell(command: string): string {
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "unknown";
  }
}

/** Git's blob hash, so a transcript names the exact bytes under test. */
export function gitBlobHash(path: string): string {
  const bytes = readFileSync(path);
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/** What was actually on screen, for when a focus check fails. */
export function windowList(): string {
  try {
    return execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(import.meta.dirname, "..", "shot.ps1"),
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    return `ERROR ${(error as Error)?.message}`;
  }
}
