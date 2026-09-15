/**
 * Guest-OS odds and ends: sleeping, killing processes, asking Windows about
 * itself, and hashing bytes the way git does.
 */
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Blunt but reliable: a half-dead Firefox is what froze the guest once. */
function taskkill(image) {
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
function powershell(command) {
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
function gitBlobHash(path) {
  const bytes = readFileSync(path);
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/** What was actually on screen, for when a focus check fails. */
function windowList() {
  try {
    return execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(__dirname, "..", "shot.ps1"),
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    return `ERROR ${error?.message}`;
  }
}

module.exports = { delay, taskkill, powershell, gitBlobHash, windowList };
