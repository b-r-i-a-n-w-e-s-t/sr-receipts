/**
 * Getting NVDA into a state where a key sequence means anything.
 *
 * This is the hard-won part of the rig. It was duplicated verbatim in both
 * `probe.cjs` and `runner.cjs`; it lives here once now.
 *
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
 * behaviour instead: try to quick-navigate, and toggle the mode if the attempt
 * is silent.
 *
 * The guard leaves the caret at the top of the document, so a sequence always
 * starts from a known position.
 */
const { windowsActivate } = require("@guidepup/guidepup");
const { delay } = require("./system.cjs");
const { FIREFOX } = require("./firefox.cjs");

/**
 * Which quick-navigation commands to use when asserting browse mode.
 *
 * The original guard probed with `moveToNextTable` alone, which was true of
 * every target the rig had at the time — the control fixture, both shape
 * fixtures, the docs page and the stresstest page all contain a table — and
 * would have reported a permanent focus-guard failure on any target that does
 * not. A component library will have plenty of those.
 *
 * The probes are tried in order and any one of them answering proves browse
 * mode, so the list runs from most to least specific. `moveToNextHeading` is the
 * effective fallback: essentially every real page has a heading. All three are
 * quick-navigation commands, which is the point — they exist only in browse
 * mode, so speech from one is positive proof of the mode rather than of the
 * page. A plain `ArrowDown` would be useless here, since it also does something
 * in focus mode.
 *
 * A target with no table, no heading and no landmark needs its own probe passed
 * in; there is no way to assert the mode without something to navigate to.
 */
const MODE_PROBES = ["moveToNextTable", "moveToNextHeading", "moveToNextLandmark"];

async function ensureReadyToNavigate(
  nvda,
  speech,
  { focusAttempts = 8, modeAttempts = 3, modeProbes = MODE_PROBES } = {},
) {
  const k = nvda.keyboardCommands;
  const seen = [];

  // A misspelled probe would reach `nvda.perform(undefined)`, which is silent —
  // and this guard reads silence as "wrong mode". The result would be a
  // focus-guard failure that looks exactly like a real one. Fail loudly instead.
  const unknown = modeProbes.filter((name) => !k[name]);
  if (unknown.length) {
    throw new Error(
      `unknown NVDA keyboard command(s) in modeProbes: ${unknown.join(", ")}`,
    );
  }

  let inDocument = false;
  for (let attempt = 1; attempt <= focusAttempts; attempt++) {
    // Discard immediately before every measured command, so `heard` is that
    // command's answer and not a backlog from launching the browser or from the
    // previous attempt's recovery keystroke. Without this the `document` test
    // below can match speech from several seconds ago.
    await speech.discard();
    await nvda.perform(k.reportCurrentFocus);
    const heard = await speech.heard();
    seen.push(`focus attempt ${attempt}: ${heard}`);
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
    for (const probe of modeProbes) {
      await nvda.press("Control+Home");
      await delay(500);
      await speech.discard();
      await nvda.perform(k[probe]);
      const heard = await speech.heard();
      seen.push(`browse mode attempt ${attempt}, ${probe}: ${heard}`);
      if (heard !== "(silence)") {
        await nvda.press("Control+Home");
        await delay(500);
        await speech.discard();
        return { ok: true, seen, provedBy: probe };
      }
    }
    await nvda.perform(k.toggleBetweenBrowseAndFocusMode);
    await delay(1000);
  }
  return { ok: false, seen };
}

module.exports = { MODE_PROBES, ensureReadyToNavigate };
