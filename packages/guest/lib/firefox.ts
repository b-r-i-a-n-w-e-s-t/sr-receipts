/**
 * Launching the browser the rig drives.
 *
 * Firefox is launched directly rather than through guidepup's `windowsActivate`
 * launch path, whose arguments (`-p1 -c`) are Chrome flags that Firefox does not
 * read as intended.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WindowSize } from "./types.ts";

const RIG = join(import.meta.dirname, "..");

export const FIREFOX =
  process.env.FIREFOX_PATH ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe";

export const PROFILE = join(RIG, "ff-profile");

/**
 * A dedicated profile makes a run hermetic: no session restore, no welcome tab,
 * no default-browser prompt, none of which can be allowed to take focus while
 * NVDA is reading.
 *
 * Rewritten on every run so a hand-edited profile cannot silently change a
 * result. The profile directory itself is gitignored.
 */
export function ensureProfile(): void {
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

export const XULSTORE = join(PROFILE, "xulstore.json");

/**
 * Size the browser window, for a scenario whose question only exists at a
 * particular width.
 *
 * Firefox has no command-line flag for this. `--window-size` sounds like one
 * and is not: its own `--help` says "Width and optionally height of
 * *screenshot*", and the old `-width`/`-height` flags no longer exist. What
 * Firefox does read is `xulstore.json`, where it persists the main window's
 * geometry between sessions, so the rig writes that file rather than restoring
 * it.
 *
 * `sizemode: normal` is load-bearing. Without it Firefox opens maximized on the
 * guest's 1920x1200 desktop and the width is ignored.
 *
 * With no size requested the file is deleted, which puts the profile back in
 * the fresh state every run had before this existed. Called on every launch, so
 * one narrow scenario cannot leave its width behind for the next target.
 */
export function writeWindowGeometry(window?: WindowSize | undefined): void {
  if (!window) {
    rmSync(XULSTORE, { force: true });
    return;
  }
  const { width, height } = window;
  writeFileSync(
    XULSTORE,
    JSON.stringify({
      "chrome://browser/content/browser.xhtml": {
        "main-window": {
          screenX: "0",
          screenY: "0",
          width: String(width),
          height: String(height),
          sizemode: "normal",
        },
      },
    }),
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
export function launch(url: string, { window }: { window?: WindowSize | undefined } = {}): ChildProcess {
  writeWindowGeometry(window);
  return spawn(FIREFOX, ["-no-remote", "-profile", PROFILE, "-new-window", url], {
    detached: true,
    stdio: "ignore",
  });
}
