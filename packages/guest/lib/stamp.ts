/**
 * The Environment Stamp: what produced the speech.
 *
 * A transcript is only evidence if it names what produced it. NVDA's phrasing
 * changes between releases, Edge's accessibility tree changes between
 * releases, and the guest is Windows on ARM64, where the available builds of
 * both are narrower than on x64. Without this block, a difference between two
 * runs cannot be attributed.
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { EDGE } from "./nvda.ts";
import { powershell } from "./system.ts";

// Package versions come from package.json files, which are not importable
// modules under ESM without a JSON import attribute. `createRequire` reads
// them with none of that ceremony and no build-time resolution.
const require = createRequire(import.meta.url);

const version = (name: string): string => {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "not installed";
  }
};

export function stamp(): string[] {
  const reg = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  const cache = join(process.env.LOCALAPPDATA ?? "", "guidepup", "nvda", "all");
  return [
    `windows: ${powershell(`(Get-ItemProperty '${reg}').DisplayVersion`)} build ${powershell(`(Get-ItemProperty '${reg}').CurrentBuild`)}.${powershell(`(Get-ItemProperty '${reg}').UBR`)} ${process.env.PROCESSOR_ARCHITECTURE}`,
    `edge: ${powershell(`(Get-Item '${EDGE}').VersionInfo.ProductVersion`)} at ${EDGE}, driven by playwright-core ${version("playwright-core")}`,
    `nvda asset: ${existsSync(cache) ? readdirSync(cache).join(", ") : "unknown"}`,
    `guidepup: ${version("@guidepup/guidepup")}`,
    `node: ${process.version}`,
    "nvda settings: guidepup bundled config, speechViewer.showSpeechViewerAtStartup=false, capture=true",
  ];
}
