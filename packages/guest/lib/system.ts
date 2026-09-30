/**
 * Guest-OS odds and ends: sleeping, asking Windows about itself, and reading
 * an installed package's version.
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Package versions come from package.json files, which are not importable
// modules under ESM without a JSON import attribute. `createRequire` reads
// them with none of that ceremony and no build-time resolution.
const require = createRequire(import.meta.url);

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a PowerShell script and return its trimmed output. Rejects when PowerShell fails. */
export async function powershell(script: string): Promise<string> {
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
  return stdout.trim();
}

/** An installed package's version, or "not installed". */
export function packageVersion(name: string): string {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "not installed";
  }
}
