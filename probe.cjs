/**
 * Fast iteration tool for working out key sequences before committing them to
 * runner.cjs. Reads `probe.json`, a list of [label, "perform:<command>"] or
 * [label, "press:<key>"] pairs, and `probe-fixture.txt` naming the target.
 * Writes `probe-out.txt`.
 *
 * The target is either a fixture file name, resolved under `fixtures\`, or an
 * `http`/`https` URL passed through unchanged. The URL form is how the live
 * docs page on the host's dev server gets probed.
 */
const { nvda, windowsActivate } = require("@guidepup/guidepup");
const { spawn, execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const RIG = __dirname;
const FIREFOX =
  process.env.FIREFOX_PATH ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fixture is a local file and loads instantly; the live docs page comes from
 * a Vite dev server across the host boundary and has to compile, hydrate and
 * settle before NVDA's virtual buffer is worth reading.
 */
function resolveTarget(target) {
  if (/^https?:/i.test(target)) return { url: target, isUrl: true, settle: 30000 };
  const path = join(RIG, "fixtures", target);
  return { url: "file:///" + path.replace(/\\/g, "/"), isUrl: false, settle: 10000 };
}

/**
 * The title guard is not enough on its own, in two separate ways.
 *
 * First, activating the window sometimes leaves the focus on Firefox's own
 * hidden menu bar: NVDA reports `menu, off screen` while the page still reports
 * `document.activeElement === body`, so the focused object is browser chrome,
 * not content. The title names Firefox throughout, so the title guard passes and
 * the transcript fills with plausible silences. `Escape` and a second
 * `windowsActivate` were both measured and neither recovers. `F6` does, by
 * cycling Firefox's focus back into the content area, and it is the only key
 * this loop will send: every other press lands on the address bar, where a
 * letter key is typed in as text rather than navigating.
 *
 * Second, being in the document is still not enough, because NVDA can be in
 * focus mode there, and in focus mode every quick-navigation command is passed
 * through to the page and answers with silence. `reportCurrentFocus` does not
 * say which mode it is in. It appends an object-replacement character in focus
 * mode, but that was measured to be unreliable, so the mode is asserted by
 * behaviour instead: try to reach a table, and toggle the mode if the attempt is
 * silent.
 *
 * That behavioural check assumes the target contains at least one table, which
 * is true of every target this rig has: the control fixture, both ticket 12
 * shape fixtures, the docs page and the stresstest page. A target without a
 * table would need a different probe.
 *
 * The guard leaves the caret at the top of the document, so a sequence always
 * starts from a known position.
 */
async function ensureReadyToNavigate(focusAttempts = 8, modeAttempts = 3) {
  const seen = [];
  const said = async () => (await nvda.spokenPhraseLog()).at(-1) ?? "";

  let inDocument = false;
  for (let attempt = 1; attempt <= focusAttempts; attempt++) {
    await nvda.perform(nvda.keyboardCommands.reportCurrentFocus);
    const heard = await said();
    seen.push(`focus attempt ${attempt}: ${heard || "(silence)"}`);
    if (/\bdocument\b/i.test(heard)) {
      inDocument = true;
      break;
    }
    // First recover by bringing the window forward, in case something else took
    // the foreground; after that, cycle Firefox's own focus into the content.
    if (attempt === 1) {
      await windowsActivate(FIREFOX, "Mozilla Firefox");
      await delay(2000);
    } else {
      await nvda.press("F6");
      await delay(1000);
    }
  }
  if (!inDocument) return { ok: false, seen };

  for (let attempt = 1; attempt <= modeAttempts; attempt++) {
    await nvda.press("Control+Home");
    await delay(500);
    await nvda.perform(nvda.keyboardCommands.moveToNextTable);
    const heard = await said();
    seen.push(`browse mode attempt ${attempt}: ${heard || "(silence)"}`);
    if (heard !== "") {
      await nvda.press("Control+Home");
      await delay(500);
      return { ok: true, seen };
    }
    await nvda.perform(nvda.keyboardCommands.toggleBetweenBrowseAndFocusMode);
    await delay(1000);
  }
  return { ok: false, seen };
}

(async () => {
  const target = readFileSync(join(RIG, "probe-fixture.txt"), "utf8").trim();
  const steps = JSON.parse(readFileSync(join(RIG, "probe.json"), "utf8"));
  const { url, settle } = resolveTarget(target);
  const out = [`# probe on ${target}`, `# url: ${url}`, ""];

  try {
    try {
      execFileSync("taskkill", ["/F", "/IM", "firefox.exe"], { stdio: "ignore" });
    } catch {}
    await delay(3000);
    mkdirSync(join(RIG, "ff-profile"), { recursive: true });

    await nvda.start({
      capture: true,
      settings: { speechViewer: { showSpeechViewerAtStartup: false } },
    });
    await delay(2000);
    spawn(
      FIREFOX,
      ["-no-remote", "-profile", join(RIG, "ff-profile"), "-new-window", url],
      { detached: true, stdio: "ignore" },
    );
    await delay(settle);
    // A freshly launched `-new-window` Firefox is already foreground with its
    // content focused. Calling windowsActivate anyway is what leaves focus on
    // the hidden menu bar about half the time (its VBScript ends in
    // SetForegroundWindow, which Windows refuses from a non-elevated process
    // while an elevated window holds the foreground, and the guest desktop runs
    // an elevated VS Code and PowerShell). So do not activate unconditionally;
    // let the guard below ask for it only if it is needed.

    // What is actually on the screen, rather than what we assume is.
    try {
      const windows = execFileSync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(RIG, "shot.ps1")],
        { encoding: "utf8" },
      );
      out.push("### windows on screen", windows.trim(), "");
    } catch (error) {
      out.push("### windows on screen", `ERROR ${error?.message}`, "");
    }

    const focus = await ensureReadyToNavigate();
    out.push(
      focus.ok ? "### focus guard: in the document, in browse mode" : "### FOCUS GUARD FAILED",
      focus.seen.join("\n"),
      "",
    );
    if (!focus.ok) {
      out.push(
        "Never reached a state where quick navigation works, so every step",
        "below would be a meaningless silence. Steps not run.",
        "",
      );
      return;
    }

    for (const [label, spec] of steps) {
      const [kind, name] = spec.split(":");
      try {
        if (kind === "perform") {
          await nvda.perform(nvda.keyboardCommands[name]);
        } else {
          await nvda.press(name);
        }
        const said = (await nvda.spokenPhraseLog()).at(-1) ?? "";
        out.push(`### ${label} [${spec}]`, said === "" ? "(silence)" : said, "");
      } catch (error) {
        out.push(`### ${label} [${spec}]`, `ERROR ${error?.message}`, "");
      }
    }
  } catch (error) {
    out.push(`### fatal`, `${error?.message} / ${error?.cause?.message ?? ""}`);
  } finally {
    writeFileSync(join(RIG, "probe-out.txt"), out.join("\n") + "\n", "utf8");
    try {
      await nvda.stop();
    } catch {}
    try {
      execFileSync("taskkill", ["/F", "/IM", "firefox.exe"], { stdio: "ignore" });
    } catch {}
    writeFileSync(join(RIG, "probe-done.txt"), new Date().toISOString(), "utf8");
  }
})();
