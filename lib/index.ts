/**
 * The rig core. Everything `runner.ts`, `probe.ts` and `smoke.ts` are built
 * from, and the surface the host-side client will drive once Phase 4 puts a
 * daemon in front of it.
 *
 * Re-exported explicitly rather than spread from each module, so the published
 * API is a list someone can read rather than whatever happened to be exported.
 */
export type * from "./types.ts";

export { delay, taskkill, powershell, gitBlobHash, windowList } from "./system.ts";
export { FIREFOX, PROFILE, XULSTORE, ensureProfile, writeWindowGeometry, launch } from "./firefox.ts";
export { SILENCE, SpeechLog, type SpeechSource } from "./speech.ts";
export {
  FIXTURES,
  SETTLE,
  DEFAULT_SCENARIO,
  slugify,
  resolveTarget,
  parseQueue,
} from "./target.ts";
export { MODE_PROBES, ensureReadyToNavigate, type GuardOptions } from "./guard.ts";
export {
  SCENARIOS,
  compileStep,
  compileScenario,
  validateWindow,
  loadScenario,
} from "./scenario.ts";
export { evaluate, validateExpectation, runCheck, validateCheck, quote } from "./expect.ts";
export { normalize, toAction, validateSteps, runSteps, type RunStepsOptions } from "./steps.ts";
export { stamp } from "./stamp.ts";
export {
  SNAPSHOTS,
  snapshotPath,
  toSnapshot,
  readSnapshot,
  writeSnapshot,
  compareSnapshot,
  type ToSnapshotInput,
} from "./snapshot.ts";
export {
  judge,
  formatVerdict,
  formatTranscript,
  toResult,
  type JudgeInput,
  type TranscriptInput,
  type ToResultInput,
} from "./report.ts";
export {
  NVDA_OPTIONS,
  FOCUS_CHECK_EVERY,
  startSession,
  stopSession,
  watchFocus,
  openTarget,
  type Session,
  type OpenTargetOptions,
} from "./session.ts";
