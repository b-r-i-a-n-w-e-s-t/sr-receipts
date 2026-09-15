/**
 * Launching the browser the rig drives.
 *
 * Firefox is launched directly rather than through guidepup's `windowsActivate`
 * launch path, whose arguments (`-p1 -c`) are Chrome flags that Firefox does not
 * read as intended.
 */
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const RIG = join(__dirname, "..");

const FIREFOX =
  process.env.FIREFOX_PATH ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe";

const PROFILE = join(RIG, "ff-profile");

/**
 * A dedicated profile makes a run hermetic: no session restore, no welcome tab,
 * no default-browser prompt, none of which can be allowed to take focus while
 * NVDA is reading.
 *
 * Rewritten on every run so a hand-edited profile cannot silently change a
 * result. The profile directory itself is gitignored.
 */
function ensureProfile() {
  mkdirSync(PROFILE, { recursive: true });
  writeFileSync(
    join(PROFILE, "user.js"),
    [
      'user_pref("browser.startup.page", 0);',
      'user_pref("browser.startup.homepage", "about:blank");',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("browser.sessionstore.resume_from_crash", false);',
      'user_pref("browser.sessionstore.max_resumed_crashes", 0);',
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.enabled", false);',
      'user_pref("browser.warnOnQuit", false);',
      'user_pref("browser.tabs.warnOnClose", false);',
    ].join("\n") + "\n",
    "utf8",
  );
}

/**
 * Kill and relaunch on the target URL. This is the path the probe proved.
 * Driving the URL bar of a blank window left the foreground on a Firefox window
 * with an empty title, and `windowsQuit` (rather than `taskkill`) is what once
 * left a zombie and a modal "already running" dialog.
 *
 * Deliberately does NOT call `windowsActivate` afterwards. A freshly launched
 * `-new-window` Firefox is already foreground with its content focused; calling
 * `windowsActivate` anyway is what leaves focus on the hidden menu bar about
 * half the time (its VBScript ends in `SetForegroundWindow`, which Windows
 * refuses from a non-elevated process while an elevated window holds the
 * foreground, and the guest desktop runs an elevated VS Code and PowerShell).
 * The readiness guard asks for activation only if it turns out to be needed.
 */
function launch(url) {
  return spawn(
    FIREFOX,
    ["-no-remote", "-profile", PROFILE, "-new-window", url],
    { detached: true, stdio: "ignore" },
  );
}

module.exports = { FIREFOX, PROFILE, ensureProfile, launch };
