/**
 * The guest's published interface: what the Mac imports.
 *
 * A VoiceOver project's fixture loads this package for its session, and
 * nothing else crosses this seam; an NVDA project never loads it. The daemon
 * and the Smoke are this package's own entry points and import their modules
 * directly, so what is listed here is exactly what a consumer can reach.
 */
export { createVoiceOverSession, type VoiceOverSessionOptions } from "../voiceover/session.ts";
