/**
 * VoiceOver as a `ReaderSession`: this file is its adapter, and
 * `createReaderSession` gives it the Transcript, the serialization and the
 * error contract every reader shares. Driven in process by the Playwright
 * fixture on a Mac, from a terminal holding the manual authorization in
 * `voiceover/README.md`.
 *
 * What VoiceOver needs that NVDA does not lives behind `VoiceOverDesktop` in
 * `voiceover/desktop.ts`; its Entry is `voiceover/entry.ts`. The browser is
 * whatever Playwright launched for the project (its WebKit, or a branded
 * Chrome), never Safari. Its application name is what VoiceOver's activation
 * needs, and the fixture passes it.
 */
import { createReaderSession, type ReaderSession } from "@sr-receipts/host";
import { createVoiceOverDesktop, type VoiceOverDesktop } from "../voiceover/desktop.ts";
import { enterWebContent } from "../voiceover/entry.ts";

export interface VoiceOverSessionOptions {
  /** The browser's application name, as macOS knows it: "Playwright" for Playwright's WebKit. */
  applicationName: string;
}

export function createVoiceOverSession({ applicationName }: VoiceOverSessionOptions, desktop: VoiceOverDesktop = createVoiceOverDesktop()): ReaderSession {
  return createReaderSession({
    reader: "voiceover",
    start: (record) => desktop.start(record),
    stop: () => desktop.stop(),
    enter: (page, _options, record) => enterWebContent(desktop, page, { applicationName }, record),
    perform: (command) => desktop.perform(command),
    press: (key) => desktop.press(key),
    next: () => desktop.next(),
    previous: () => desktop.previous(),
    capture: (action) => desktop.capture(action),
    spokenPhraseLog: () => desktop.spokenPhraseLog(),
    clearSpokenPhraseLog: () => desktop.clearSpokenPhraseLog(),
    environment: async () => desktop.environment(),
  });
}
