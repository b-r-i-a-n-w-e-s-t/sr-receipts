/**
 * Ticket 04's smoke test, and the seed for ticket 05's harness.
 *
 * Run inside the guest, from the directory holding `fixtures/`:
 *
 *   node smoke.cjs fixtures\control.html
 *
 * Triggering it over plain SSH does not work. See ticket 05's comments: the
 * run has to be started by a scheduled task registered with `/it` so it lands
 * in the logged-in console session.
 */
const { nvda, windowsActivate, windowsQuit } = require("@guidepup/guidepup");
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FIREFOX =
  process.env.FIREFOX_PATH ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const fixture = resolve(process.argv[2] ?? "fixtures/control.html");
const url = "file:///" + fixture.replace(/\\/g, "/");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];

async function step(label, action) {
  await action();
  const said = (await nvda.spokenPhraseLog()).at(-1) ?? "";
  const text = said === "" ? "(silence)" : said;
  out.push(`### ${label}\n${text}`);
  console.log(`${label}\n    ${text}\n`);
}

(async () => {
  try {
    // capture: true keeps whole announcements; the default "initial" truncates
    // at the first phrase. The speechViewer override stops NVDA's own viewer
    // window from opening and taking focus away from the browser.
    await nvda.start({
      capture: true,
      settings: { speechViewer: { showSpeechViewerAtStartup: false } },
    });
    await delay(2000);

    // Launched here rather than through windowsActivate, whose own launch path
    // passes Chrome flags (`-p1 -c`) that Firefox does not read as intended.
    spawn(FIREFOX, ["-new-window", url], { detached: true, stdio: "ignore" });
    await delay(10000);
    await windowsActivate(FIREFOX, "Mozilla Firefox");
    await delay(3000);

    // reportTitle and reportCurrentFocus need the NVDA modifier, which press()
    // cannot express: its only modifiers are Shift, Control and Alt.
    await step("title bar (NVDA+T)", () =>
      nvda.perform(nvda.keyboardCommands.reportTitle),
    );
    await step("current focus (NVDA+Tab)", () =>
      nvda.perform(nvda.keyboardCommands.reportCurrentFocus),
    );
    await step("next table (T)", () =>
      nvda.perform(nvda.keyboardCommands.moveToNextTable),
    );
    await step("next table again (T)", () =>
      nvda.perform(nvda.keyboardCommands.moveToNextTable),
    );
  } catch (error) {
    console.error("FAILED:", error?.message);
    console.error("CAUSE:", error?.cause?.message ?? error?.cause ?? "(none)");
    out.push(`### error\n${error?.message}\n${error?.cause?.message ?? ""}`);
  } finally {
    writeFileSync("smoke-log.txt", out.join("\n\n") + "\n", "utf8");
    try {
      await nvda.stop();
    } catch {}
    try {
      await windowsQuit("firefox.exe");
    } catch {}
  }
})();
