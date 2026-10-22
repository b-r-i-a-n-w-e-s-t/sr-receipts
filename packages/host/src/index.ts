/**
 * `@sr-receipts/host`: the reader interface a test uses, the Reader Session
 * that gives every reader its Transcript and invariants, the wire to a guest
 * daemon, and NVDA as a session over that wire. Re-exported explicitly, so
 * the package's contract is a list someone can read.
 */
export type * from "./protocol.ts";
export { PROTOCOL_VERSION } from "./protocol.ts";
export { SILENCE, createReaderSession, errorChain, type ReaderAdapter, type Recorder } from "./session.ts";
export { RigError, createNvdaSession, daemonHealth, type ClientOptions } from "./client.ts";
