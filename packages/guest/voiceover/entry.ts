/**
 * Putting VoiceOver on a page's web content and proving it: VoiceOver's
 * Entry, the counterpart of NVDA's Focus Guard in `lib/guard.ts`.
 *
 * There is no browse mode, so there are no mode probes. Arrival is proved by
 * the Item Chooser sequence returning, which it does only once VoiceOver has
 * spoken the Web Content entry, and by the first item having text. The
 * sequence is the stock @guidepup/playwright one, with bounds on both loops,
 * which the stock ones lack. The marker input is the stock trick that makes
 * VoiceOver notice later Playwright interactions.
 */
import { SILENCE, type EntryPage, type Recorder } from "@sr-receipts/host";
import type { VoiceOverDesktop } from "./desktop.ts";

/**
 * How VoiceOver says the Item Chooser opened. On macOS 26 it usually speaks
 * only the highlighted entry, "On item <name>", and never the words "Item
 * Chooser"; the "VoiceOver Menu" this used to match was in the hint that
 * follows, which is off. Matching on the name alone spins forever against a
 * chooser that is already open. This also matches VoiceOver's other menus,
 * which is acceptable: landing in the wrong menu then fails in the search
 * with the phrase VoiceOver actually spoke.
 */
const ITEM_CHOOSER_ANNOUNCEMENT = /item chooser|voiceover menu|^on item /i;
export const CHOOSER_ATTEMPTS = 10;
export const SEARCH_ATTEMPTS = 5;

export interface EnterWebContentOptions {
  /** The browser's application name, as macOS knows it: "Playwright" for Playwright's WebKit. */
  applicationName: string;
  chooserAttempts?: number | undefined;
  searchAttempts?: number | undefined;
}

/**
 * The marker functions below run in the browser, through `page.evaluate`,
 * where `document` exists. This package is typechecked against Node's
 * library only, so the two members they use are declared here.
 */
declare const document: {
  body: { prepend(node: unknown): void };
  createElement(tag: string): Record<string, unknown> & { style: { cssText: string }; setAttribute(name: string, value: string): void };
  querySelector(selector: string): { remove(): void } | null;
};

/** Returns what the cursor landed on; throws, after recording each step, when the proof fails. */
export async function enterWebContent(
  desktop: VoiceOverDesktop,
  page: EntryPage,
  { applicationName, chooserAttempts = CHOOSER_ATTEMPTS, searchAttempts = SEARCH_ATTEMPTS }: EnterWebContentOptions,
  record: Recorder,
): Promise<string> {
  const { chooser } = desktop;
  await desktop.activate(applicationName);
  await chooser.key("Control");
  await page.bringToFront();
  await page.evaluate(() => {
    const marker = document.createElement("input");
    marker.id = "__guidepup_marker__";
    marker.type = "text";
    marker.value = "Guidepup Marker";
    marker.readOnly = true;
    marker.tabIndex = -1;
    marker.autocomplete = "off";
    marker.setAttribute("aria-label", "Guidepup Marker");
    marker.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
    document.body.prepend(marker);
  });
  try {
    let spoken = "";
    for (let attempt = 1; ; attempt++) {
      spoken = await chooser.open();
      record(`open item chooser (attempt ${attempt}): ${spoken || SILENCE}`);
      if (ITEM_CHOOSER_ANNOUNCEMENT.test(spoken)) break;
      if (attempt >= chooserAttempts) {
        throw new Error(`Item Chooser did not open in ${chooserAttempts} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
      }
    }
    let matched = false;
    for (let round = 1; round <= searchAttempts && !matched; round++) {
      for (const character of "web content") {
        spoken = await chooser.type(character);
        if (spoken.toLowerCase().includes("web content")) {
          matched = true;
          break;
        }
      }
      record(`item chooser search (round ${round}): ${spoken || SILENCE}`);
      if (!matched) await chooser.key("Backspace");
    }
    if (!matched) {
      throw new Error(`Item Chooser had no Web Content entry after ${searchAttempts} attempts; VoiceOver last said ${JSON.stringify(spoken)}`);
    }
    await chooser.choose();
    const arrivedOn = await chooser.firstItem();
    record(`### focus guard: VoiceOver cursor in the web content, on ${JSON.stringify(arrivedOn)}`);
    if (!arrivedOn) throw new Error("entered web content, but the first item has no text");
    return arrivedOn;
  } finally {
    await page.evaluate(() => document.querySelector("#__guidepup_marker__")?.remove()).catch(() => undefined);
  }
}
