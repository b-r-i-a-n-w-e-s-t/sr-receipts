/**
 * `@sr-receipts/host`: the reader interface a test uses, the wire to a guest
 * daemon, and NVDA as a session over that wire. Re-exported explicitly, so the
 * package's contract is a list someone can read.
 */
export type * from "./protocol.ts";
export {
  SILENCE,
  RigError,
  connectReader,
  createNvdaSession,
  type ClientOptions,
  type RemoteReader,
} from "./client.ts";
