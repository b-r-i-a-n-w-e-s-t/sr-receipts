/**
 * The environment block at the head of every transcript.
 *
 * A transcript is only evidence if it names what produced it. NVDA's phrasing
 * changes between releases, Firefox's accessibility tree changes between
 * releases, and the guest is Windows on ARM64, where the available builds of
 * both are narrower than on x64. Without this block, a diff between two runs
 * cannot be attributed.
 */
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { powershell } = require("./system.cjs");
const { FIREFOX } = require("./firefox.cjs");

function stamp() {
  const reg = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  const cache = join(process.env.LOCALAPPDATA, "guidepup", "nvda", "all");
  return [
    `windows: ${powershell(`(Get-ItemProperty '${reg}').DisplayVersion`)} build ${powershell(`(Get-ItemProperty '${reg}').CurrentBuild`)}.${powershell(`(Get-ItemProperty '${reg}').UBR`)} ${process.env.PROCESSOR_ARCHITECTURE}`,
    `firefox: ${powershell(`(Get-Item '${FIREFOX}').VersionInfo.ProductVersion`)} at ${FIREFOX}`,
    `nvda asset: ${existsSync(cache) ? readdirSync(cache).join(", ") : "unknown"}`,
    `guidepup: ${require("@guidepup/guidepup/package.json").version}`,
    `node: ${process.version}`,
    `nvda settings: guidepup bundled config, speechViewer.showSpeechViewerAtStartup=false, capture=true`,
  ];
}

module.exports = { stamp };
