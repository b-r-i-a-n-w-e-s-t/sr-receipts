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
import { join } from "node:path";
import { EDGE } from "./nvda.ts";
import { packageVersion, powershell } from "./system.ts";

/**
 * Every line is collected even when a query fails, because the stamp is
 * provenance: a line saying "unknown" is better than a lost run.
 */
export async function stamp(ask: (script: string) => Promise<string> = powershell): Promise<string[]> {
  const query = (script: string): Promise<string> => ask(script).catch(() => "unknown");
  const reg = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  const cache = join(process.env.LOCALAPPDATA ?? "", "guidepup", "nvda", "all");
  const [release, build, revision, edge] = await Promise.all([
    query(`(Get-ItemProperty '${reg}').DisplayVersion`),
    query(`(Get-ItemProperty '${reg}').CurrentBuild`),
    query(`(Get-ItemProperty '${reg}').UBR`),
    query(`(Get-Item '${EDGE}').VersionInfo.ProductVersion`),
  ]);
  return [
    `windows: ${release} build ${build}.${revision} ${process.env.PROCESSOR_ARCHITECTURE}`,
    `edge: ${edge} at ${EDGE}, driven by playwright-core ${packageVersion("playwright-core")}`,
    `nvda asset: ${existsSync(cache) ? readdirSync(cache).join(", ") : "unknown"}`,
    `guidepup: ${packageVersion("@guidepup/guidepup")}`,
    `node: ${process.version}`,
    "nvda settings: guidepup bundled config, speechViewer.showSpeechViewerAtStartup=false, capture=true",
  ];
}
