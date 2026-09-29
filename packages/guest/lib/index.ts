/**
 * The guest's core: everything `daemon.ts` and `smoke.ts` are built from, and
 * the VoiceOver session the Playwright fixture imports on a Mac.
 *
 * Re-exported explicitly rather than spread from each module, so the published
 * API is a list someone can read rather than whatever happened to be exported.
 */
export { delay, taskkill, powershell } from "./system.ts";
export { stamp } from "./stamp.ts";
export { EDGE, NVDA_OPTIONS, createNvdaDesktop, type GuidepupNvda, type NvdaDesktop, type NvdaDesktopOptions } from "./nvda.ts";
export { MODE_PROBES, enterDocument, validateModeProbes, type EnterDocumentOptions } from "./guard.ts";
export {
  DEFAULT_BROWSER_PORT,
  DEFAULT_PORT,
  createRigServer,
  resolveToken,
  type RigServerOptions,
  type TokenResolution,
} from "./daemon.ts";
export {
  createVoiceOverSession,
  type VoiceOverDesktop,
  type VoiceOverReader,
  type VoiceOverSessionOptions,
} from "./voiceover.ts";
