/**
 * Getting NVDA into a state where a key sequence means anything.
 *
 * This is the hard-won part of the rig, and it is what the stock Guidepup
 * fixture lacks. Three guards, in order, each proved rather than assumed:
 *
 * 1. **The browser is in front.** Activation runs in the interactive session,
 *    and the title NVDA reports (NVDA+T, which NVDA intercepts globally, so it
 *    types nothing) has to begin with the page's title. Alt+Esc was measured
 *    to cycle between other windows without ever reaching the browser.
 *
 * 2. **Focus is in the document.** Activating a window can leave focus on the
 *    browser's own hidden menu bar: NVDA reports `menu` while the page still
 *    reports `document.activeElement === body`. The title names the browser
 *    throughout, so a title guard passes and a transcript fills with plausible
 *    silences. `Escape` and a second activation were both measured and
 *    neither recovers. `F6` does, by cycling the browser's focus back into
 *    the content, and it is the only key this loop sends: every other press
 *    lands on the address bar, where a letter is typed as text.
 *
 * 3. **Browse mode is on.** In focus mode every quick-navigation command is
 *    passed through to the page and answers with silence, and
 *    `reportCurrentFocus` does not say which mode it is in (it appends an
 *    object-replacement character in focus mode, which was measured to be
 *    unreliable). So the mode is asserted by behaviour: quick-navigate, and
 *    toggle the mode if the attempt is silent. Every NVDA run of the pivot's
 *    proof of concept found focus mode here, and only this caught it.
 *
 * The guard leaves the caret at the top of the document, so a test always
 * starts from a known position.
 */
import type { EntryResult } from "@sr-receipts/host";
import type { NvdaDesktop } from "./nvda.ts";
import { delay as wait } from "./system.ts";

/**
 * Which quick-navigation commands to use when asserting browse mode, tried in
 * order. Any one answering proves the mode, so the list runs from most to
 * least specific, and `moveToNextHeading` is the effective fallback: nearly
 * every real page has a heading. All three exist only in browse mode, which
 * is the point; a plain `ArrowDown` would be useless, since it also does
 * something in focus mode. A page with none of the three needs its own probe.
 */
export const MODE_PROBES = ["moveToNextTable", "moveToNextHeading", "moveToNextLandmark"];

export interface EnterDocumentOptions {
  /** The page's title; the reported window title must begin with it. */
  pageTitle: string;
  modeProbes?: string[] | undefined;
  activateAttempts?: number | undefined;
  focusAttempts?: number | undefined;
  modeAttempts?: number | undefined;
  delay?: ((milliseconds: number) => Promise<void>) | undefined;
}

/**
 * Throw unless every mode probe is a command NVDA has. A misspelled probe
 * would reach `nvda.perform(undefined)`, which is silent, and the guard reads
 * silence as "wrong mode": a guard failure that looks exactly like a real
 * one. The desktop's `perform` refuses an unknown name; this asks first.
 */
export function validateModeProbes(commands: Readonly<Record<string, unknown>>, modeProbes: readonly string[] = MODE_PROBES): void {
  const unknown = modeProbes.filter((name) => !commands[name]);
  if (unknown.length) throw new Error(`unknown NVDA keyboard command(s) in modeProbes: ${unknown.join(", ")}`);
}

/**
 * Punctuation to spaces and whitespace collapsed, the way Guidepup's own
 * fixture compares titles: NVDA speaks symbols as words ("<" is "less"), so a
 * title with any in it never matches character for character.
 */
const clean = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[|¦:;,.'"`\-‐–—·_()[\]{}\\^~<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether the browser showing the page is in front. The window title Windows
 * reports after activation is the page's title verbatim, so it is checked
 * first; NVDA's spoken title, with its symbols read out, is the fallback. A
 * page with no title is matched on the browser's name instead.
 */
const titleMatches = (foreground: string, reported: string, pageTitle: string): boolean => {
  if (!pageTitle) return /edge/i.test(foreground) || /edge/i.test(reported);
  const page = clean(pageTitle).slice(0, 20);
  return foreground.startsWith(pageTitle) || clean(foreground).startsWith(page) || clean(reported).startsWith(page);
};

export async function enterDocument(
  desktop: NvdaDesktop,
  {
    pageTitle,
    modeProbes = MODE_PROBES,
    activateAttempts = 4,
    focusAttempts = 6,
    modeAttempts = 3,
    delay = wait,
  }: EnterDocumentOptions,
): Promise<EntryResult> {
  const lines: string[] = [];
  const failed = async (heading: string): Promise<EntryResult> => {
    lines.unshift(heading);
    lines.push("### windows on screen", ...(await desktop.windows().catch((error: Error) => [`ERROR ${error.message}`])));
    return { ok: false, arrivedOn: "", lines };
  };

  let title = "";
  for (let attempt = 1; ; attempt++) {
    const foreground = await desktop.activateBrowser();
    lines.push(`activate browser (attempt ${attempt}): foreground is ${foreground || "(unknown)"}`);
    await delay(500);
    title = await desktop.perform("reportTitle");
    lines.push(`title reported: ${title}`);
    if (titleMatches(foreground, title, pageTitle)) break;
    if (attempt >= activateAttempts) return failed(`### FOCUS GUARD FAILED: the browser is not in front (page title ${JSON.stringify(pageTitle)})`);
  }

  await desktop.perform("exitFocusMode");
  await delay(100);
  let inDocument = false;
  for (let attempt = 1; attempt <= focusAttempts; attempt++) {
    const focus = await desktop.perform("reportCurrentFocus");
    lines.push(`focus attempt ${attempt}: ${focus}`);
    if (/\bdocument\b/i.test(focus)) {
      inDocument = true;
      break;
    }
    await desktop.press("F6");
    await delay(1000);
  }
  if (!inDocument) return failed("### FOCUS GUARD FAILED: focus never reached the document");

  for (let attempt = 1; attempt <= modeAttempts; attempt++) {
    for (const probe of modeProbes) {
      await desktop.press("Control+Home");
      await delay(300);
      const heard = await desktop.perform(probe);
      lines.push(`browse mode attempt ${attempt}, ${probe}: ${heard || "(silence)"}`);
      if (heard) {
        const arrivedOn = await desktop.press("Control+Home");
        await delay(300);
        lines.push(`### focus guard: in the document, in browse mode (proved by ${probe})`, `top of the document: ${arrivedOn || "(silence)"}`);
        return { ok: true, arrivedOn: arrivedOn || heard, lines };
      }
    }
    await desktop.perform("toggleBetweenBrowseAndFocusMode");
    await delay(1000);
  }
  return failed("### FOCUS GUARD FAILED: browse mode could not be proved; quick navigation never answered");
}
