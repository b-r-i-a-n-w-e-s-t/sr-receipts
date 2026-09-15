/**
 * Ticket 05's harness. Runs one key sequence per fixture, all fixtures in a
 * single NVDA session, and writes one stamped transcript per fixture.
 *
 * Reads `queue.txt` (one fixture file name per line) from the rig directory.
 * Writes `runs/<runId>/<fixture>.txt` plus a `DONE` marker the host polls for.
 *
 * Must be started by the scheduled task, not over plain SSH: an SSH session has
 * no interactive desktop, so NVDA has no foreground window to describe. See
 * ticket 04.
 */
const { nvda, windowsActivate } = require("@guidepup/guidepup");
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} = require("node:fs");
const { join } = require("node:path");

const RIG = __dirname;
const FIXTURES = join(RIG, "fixtures");
const FIREFOX =
  process.env.FIREFOX_PATH ?? "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Blunt but reliable: a half-dead Firefox is what froze the guest once. */
function taskkill(image) {
  try {
    execFileSync("taskkill", ["/F", "/IM", image], { stdio: "ignore" });
  } catch {
    // nothing to kill
  }
}

const PROFILE = join(__dirname, "ff-profile");

/**
 * A dedicated profile makes a run hermetic: no session restore, no welcome tab,
 * no default-browser prompt, none of which can be allowed to take focus while
 * NVDA is reading.
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

const k = nvda.keyboardCommands;

/**
 * Mirrors the protocol's checks so the transcript maps onto its ledger:
 * table framing and quick nav, cell navigation across a row and down a column,
 * a line read-through to catch double announcement of the detail, and Tab to
 * test whether controls inside the detail are reachable.
 */
function sequence() {
  const steps = [
    ["title bar", () => nvda.perform(k.reportTitle)],
    ["focus and mode", () => nvda.perform(k.reportCurrentFocus)],
    ["T table framing", () => nvda.perform(k.moveToNextTable)],
    ["T again", () => nvda.perform(k.moveToNextTable)],
    ["shift+T back", () => nvda.perform(k.moveToPreviousTable)],
    // T lands the caret on the table's name or caption, which is inside the
    // table but not in a cell, and cell navigation refuses to move from there.
    // One ArrowDown enters row 1 column 1. Proven on control.html; see the
    // probe in ticket 05's comments.
    ["arrow down to enter the table", () => nvda.press("ArrowDown")],
    ["ctrl+alt+down to first data row", () => nvda.perform(k.moveToNextRow)],
  ];

  // Walk the whole data row. G exposes 10 columns, 05 exposes 9, so 11 moves
  // run off the end in both and the boundary announcement is itself evidence.
  for (let i = 1; i <= 11; i++) {
    steps.push([
      `ctrl+alt+right, move ${i}`,
      () => nvda.perform(k.moveToNextColumn),
    ]);
  }
  for (let i = 1; i <= 3; i++) {
    steps.push([
      `ctrl+alt+down, row +${i}`,
      () => nvda.perform(k.moveToNextRow),
    ]);
  }
  steps.push([
    "ctrl+alt+left, back one cell",
    () => nvda.perform(k.moveToPreviousColumn),
  ]);

  // Read-through from the table start, which is where double announcement of
  // the detail (name then content) would show up.
  steps.push(["ctrl+home to top", () => nvda.press("Control+Home")]);
  steps.push(["T table framing, repeat", () => nvda.perform(k.moveToNextTable)]);
  for (let i = 1; i <= 30; i++) {
    steps.push([`arrow down, line ${i}`, () => nvda.press("ArrowDown")]);
  }

  // Tab from inside the expanded detail: are its controls reachable?
  for (let i = 1; i <= 8; i++) {
    steps.push([`tab ${i}`, () => nvda.press("Tab")]);
  }

  return steps;
}

/** What was actually on screen, for when a focus check fails. */
function windowList() {
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(__dirname, "shot.ps1")],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    return `ERROR ${error?.message}`;
  }
}

async function focusedTitle() {
  await nvda.perform(k.reportTitle);
  return (await nvda.spokenPhraseLog()).at(-1) ?? "";
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
    await nvda.perform(k.reportCurrentFocus);
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
    await nvda.perform(k.moveToNextTable);
    const heard = await said();
    seen.push(`browse mode attempt ${attempt}: ${heard || "(silence)"}`);
    if (heard !== "") {
      await nvda.press("Control+Home");
      await delay(500);
      return { ok: true, seen };
    }
    await nvda.perform(k.toggleBetweenBrowseAndFocusMode);
    await delay(1000);
  }
  return { ok: false, seen };
}

/**
 * A queue entry is either a fixture file name, resolved under `fixtures\`, or
 * an `http`/`https` URL passed through unchanged. A URL has no local bytes to
 * hash, and it comes from a Vite dev server across the host boundary, so it
 * needs longer to compile, hydrate and settle than a local file does.
 */
function resolveTarget(target) {
  if (/^https?:/i.test(target)) {
    return {
      url: target,
      provenance: `url, no local bytes to hash: ${target}`,
      settle: 30000,
      slug: target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""),
    };
  }
  const path = join(FIXTURES, target);
  return {
    url: "file:///" + path.replace(/\\/g, "/"),
    provenance: `fixture git blob: ${gitBlobHash(path)}`,
    settle: 14000,
    slug: target,
  };
}

async function runFixture(fixture, outDir) {
  const { url, provenance, settle, slug } = resolveTarget(fixture);
  const lines = [
    `# ${fixture}`,
    "",
    ...stamp(),
    provenance,
    `run started: ${new Date().toISOString()}`,
    "",
  ];

  // Kill and relaunch on the fixture URL. This is the path the probe proved.
  // Driving the URL bar of a blank window left the foreground on a Firefox
  // window with an empty title, and windowsQuit (rather than taskkill) is what
  // once left a zombie and a modal "already running" dialog.
  taskkill("firefox.exe");
  await delay(3000);
  spawn(
    FIREFOX,
    ["-no-remote", "-profile", PROFILE, "-new-window", url],
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

  // Fail fast rather than logging sixty silences into a useless transcript.
  const title = await focusedTitle();
  if (!/Mozilla Firefox/i.test(title)) {
    await windowsActivate(FIREFOX, "Mozilla Firefox");
    await delay(3000);
    const retry = await focusedTitle();
    if (!/Mozilla Firefox/i.test(retry)) {
      lines.push("### FOCUS FAILED", `title reported: ${retry}`, "");
      lines.push("### windows on screen", windowList(), "");
      writeFileSync(join(outDir, `${slug}.txt`), lines.join("\n"), "utf8");
      return;
    }
  }

  // The window is Firefox; now make sure the keystrokes will reach its content
  // and that quick navigation actually answers.
  const focus = await ensureReadyToNavigate();
  lines.push(
    focus.ok ? "### focus guard: in the document, in browse mode" : "### FOCUS GUARD FAILED",
    focus.seen.join("\n"),
    "",
  );
  if (!focus.ok) {
    lines.push("### windows on screen", windowList(), "");
    lines.push(
      "Never reached a state where quick navigation works, so the sequence",
      "would only record meaningless silences. Sequence not run.",
      "",
    );
    writeFileSync(join(outDir, `${slug}.txt`), lines.join("\n"), "utf8");
    return;
  }

  for (const [label, action] of sequence()) {
    try {
      await action();
      const said = (await nvda.spokenPhraseLog()).at(-1) ?? "";
      lines.push(`### ${label}`, said === "" ? "(silence)" : said, "");
      console.log(`${fixture} :: ${label} :: ${said || "(silence)"}`);
    } catch (error) {
      lines.push(`### ${label}`, `ERROR ${error?.message}`, "");
    }
  }

  writeFileSync(join(outDir, `${slug}.txt`), lines.join("\n"), "utf8");
}

(async () => {
  const queuePath = join(RIG, "queue.txt");
  const queue = existsSync(queuePath)
    ? readFileSync(queuePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : ["control.html"];

  const runId = new Date()
    .toISOString()
    .replace(/[:]/g, "")
    .replace(/\..+$/, "");
  const outDir = join(RIG, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  try {
    taskkill("firefox.exe");
    taskkill("nvda.exe");
    await delay(3000);
    ensureProfile();

    await nvda.start({
      capture: true,
      settings: { speechViewer: { showSpeechViewerAtStartup: false } },
    });
    await delay(2000);

    // One NVDA session for the whole queue: same version, same settings, same
    // voice, so a diff between two fixtures cannot be version drift.
    for (const fixture of queue) {
      await runFixture(fixture, outDir);
    }
  } catch (error) {
    writeFileSync(
      join(outDir, "ERROR.txt"),
      `${error?.message}\n${error?.cause?.message ?? error?.cause ?? ""}\n`,
      "utf8",
    );
  } finally {
    try {
      await nvda.stop();
    } catch {}
    taskkill("firefox.exe");
    writeFileSync(join(outDir, "DONE"), `${new Date().toISOString()}\n`, "utf8");
    writeFileSync(join(RIG, "last-run.txt"), `${runId}\n`, "utf8");
  }
})();
