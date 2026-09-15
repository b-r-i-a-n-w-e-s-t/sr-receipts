/**
 * The rig's lifecycle: start NVDA once, open targets in it one after another,
 * stop cleanly whatever happened.
 *
 * One NVDA session for a whole queue is deliberate: same version, same settings,
 * same voice, so a diff between two targets cannot be version drift.
 *
 * `startSession` must be reached from the interactive console session. Starting
 * it over plain SSH does not work — an SSH session has no interactive desktop,
 * so NVDA has no foreground window to describe. That is what the `nvda-run`,
 * `nvda-probe` and `nvda-smoke` scheduled tasks are for.
 */
import { nvda, windowsActivate } from "@guidepup/guidepup";
import { delay, taskkill, windowList } from "./system.ts";
import { FIREFOX, ensureProfile, launch } from "./firefox.ts";
import { SpeechLog } from "./speech.ts";
import { ensureReadyToNavigate } from "./guard.ts";
import { resolveTarget } from "./target.ts";
import type { NvdaCommand, OpenResult, WindowSize } from "./types.ts";

/**
 * `capture: true` keeps whole announcements; the default `"initial"` truncates
 * at the first phrase. The speechViewer override stops NVDA's own viewer window
 * from opening and taking focus away from the browser.
 */
export const NVDA_OPTIONS = {
  capture: true,
  settings: { speechViewer: { showSpeechViewerAtStartup: false } },
} as const;

export interface Session {
  nvda: typeof nvda;
  speech: SpeechLog;
}

export async function startSession(): Promise<Session> {
  taskkill("firefox.exe");
  taskkill("nvda.exe");
  await delay(3000);
  ensureProfile();

  await nvda.start(NVDA_OPTIONS);
  await delay(2000);

  const speech = new SpeechLog(nvda);
  await speech.discard();
  return { nvda, speech };
}

/** Never throws: a failed teardown must not mask the error that caused it. */
export async function stopSession(): Promise<void> {
  try {
    await nvda.stop();
  } catch {
    // already gone
  }
  taskkill("firefox.exe");
}

async function focusedTitle(speech: SpeechLog): Promise<string> {
  await speech.discard();
  await nvda.perform(nvda.keyboardCommands.reportTitle);
  return await speech.heard();
}

export interface OpenTargetOptions {
  settle?: number | undefined;
  modeProbes?: NvdaCommand[] | undefined;
  window?: WindowSize | undefined;
}

/**
 * Open one target and leave NVDA at the top of its document in browse mode.
 *
 * `lines` is transcript prose describing how the guards went — append it to the
 * transcript whether or not `ok`, because when `ok` is false those lines are the
 * entire diagnosis.
 *
 * Fails fast rather than logging sixty silences into a useless transcript.
 *
 * `window` sizes the browser before it opens, for a scenario whose question
 * only exists at a particular width. See lib/firefox.ts.
 */
export async function openTarget(
  speech: SpeechLog,
  entry: string,
  { settle, modeProbes, window }: OpenTargetOptions = {},
): Promise<OpenResult> {
  const target = resolveTarget(entry, { settle });
  const lines: string[] = [];

  taskkill("firefox.exe");
  await delay(3000);
  launch(target.url, { window });
  await delay(target.settle);

  const title = await focusedTitle(speech);
  if (!/Mozilla Firefox/i.test(title)) {
    await windowsActivate(FIREFOX, "Mozilla Firefox");
    await delay(3000);
    const retry = await focusedTitle(speech);
    if (!/Mozilla Firefox/i.test(retry)) {
      lines.push("### FOCUS FAILED", `title reported: ${retry}`, "");
      lines.push("### windows on screen", windowList(), "");
      return { ok: false, lines, target };
    }
  }

  // The window is Firefox; now make sure the keystrokes will reach its content
  // and that quick navigation actually answers.
  const focus = await ensureReadyToNavigate(nvda, speech, { modeProbes });
  lines.push(
    focus.ok
      ? `### focus guard: in the document, in browse mode (proved by ${focus.provedBy})`
      : "### FOCUS GUARD FAILED",
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
    return { ok: false, lines, target };
  }

  return { ok: true, lines, target };
}
