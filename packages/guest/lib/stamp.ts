/**
 * The environment block at the head of every transcript.
 *
 * A transcript is only evidence if it names what produced it. NVDA's phrasing
 * changes between releases, Firefox's accessibility tree changes between
 * releases, and the guest is Windows on ARM64, where the available builds of
 * both are narrower than on x64. Without this block, a diff between two runs
 * cannot be attributed.
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { powershell } from "./system.ts";
import { FIREFOX } from "./firefox.ts";

// guidepup's version comes from its package.json, which is not an importable
// module under ESM without a JSON import attribute. `createRequire` reads it
// with none of that ceremony and no build-time resolution.
const require = createRequire(import.meta.url);

export function stamp(): string[] {
  const reg = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  const cache = join(process.env.LOCALAPPDATA ?? "", "guidepup", "nvda", "all");
  const guidepup = require("@guidepup/guidepup/package.json") as { version: string };
  return [
    `windows: ${powershell(`(Get-ItemProperty '${reg}').DisplayVersion`)} build ${powershell(`(Get-ItemProperty '${reg}').CurrentBuild`)}.${powershell(`(Get-ItemProperty '${reg}').UBR`)} ${process.env.PROCESSOR_ARCHITECTURE}`,
    `firefox: ${powershell(`(Get-Item '${FIREFOX}').VersionInfo.ProductVersion`)} at ${FIREFOX}`,
    `nvda asset: ${existsSync(cache) ? readdirSync(cache).join(", ") : "unknown"}`,
    `guidepup: ${guidepup.version}`,
    `node: ${process.version}`,
    `nvda settings: guidepup bundled config, speechViewer.showSpeechViewerAtStartup=false, capture=true`,
  ];
}
