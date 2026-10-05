/**
 * What one Smoke leaves behind for the Provisioner, printed as the last line
 * of `smoke.ts`'s stdout beside the transcript file it writes. Named here so
 * the Smoke and the health reporter cannot disagree about it.
 */

/** The committed page the Smoke opens: it proves the rig, not any app. */
export const SMOKE_CONTROL_FIXTURE = "control.html";

/**
 * What is asked once the guards have passed: the title, the focus, and quick
 * navigation twice. Any of them speaking proves the desktop is the daemon's.
 */
export const SMOKE_COMMANDS = ["reportTitle", "reportCurrentFocus", "moveToNextTable", "moveToNextTable"];

export interface SmokeResult {
  /** The daemon answered, the page was reached, and at least one command spoke. */
  ok: boolean;
  /** The daemon answered `/health` before the deadline. */
  daemon: boolean;
  /** The Focus Guard passed. */
  entered: boolean;
  /** Commands asked once entered, and how many of them answered with speech. */
  commands: number;
  spoke: number;
  /** Why it stopped, outermost cause first, when it did not get to the end. */
  error: string | null;
  /** The Environment Stamp the daemon serves, empty when it never answered. */
  environment: string[];
}
