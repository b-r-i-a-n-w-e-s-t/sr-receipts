/**
 * Mac odds and ends: sleeping, and reading an installed package's version.
 */
import { createRequire } from "node:module";

// Package versions come from package.json files, which are not importable
// modules under ESM without a JSON import attribute. `createRequire` reads
// them with none of that ceremony and no build-time resolution.
const require = createRequire(import.meta.url);

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** An installed package's version, or "not installed". */
export function packageVersion(name: string): string {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "not installed";
  }
}
