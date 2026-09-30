/**
 * `@sr-receipts/playwright`: a `reader` fixture for Playwright Test, so a
 * consuming repo drives a real screen reader beside `page` from its own
 * tests. Re-exported explicitly, so the package's contract is a list someone
 * can read.
 */
export { withReader, readerFixtures, applicationNameFor, type ReaderOptions } from "./fixture.ts";
export { readerMatchers } from "./matchers.ts";
export type { Captured, EntryOptions, EntryPage, Reader, ReaderSession } from "@sr-receipts/host";
export { SILENCE } from "@sr-receipts/host";
