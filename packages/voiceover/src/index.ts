/**
 * `@sr-receipts/voiceover`: VoiceOver as a Reader Session, in process on this
 * Mac. A VoiceOver project's fixture loads this package for its session, and
 * nothing else crosses this seam; an NVDA project never loads it.
 */
export { createVoiceOverSession, type VoiceOverSessionOptions } from "./session.ts";
