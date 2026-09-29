/**
 * Guest-OS odds and ends: sleeping, killing processes, and asking Windows
 * about itself.
 */
import { execFileSync } from "node:child_process";

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Blunt but reliable: a half-dead browser is what froze the guest once. */
export function taskkill(image: string): void {
  try {
    execFileSync("taskkill", ["/F", "/IM", image], { stdio: "ignore" });
  } catch {
    // nothing to kill
  }
}

/**
 * Returns "unknown" rather than throwing, because every caller is collecting
 * provenance for a stamp and a missing line is better than a lost run.
 */
export function powershell(command: string): string {
  try {
    return execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}
