/**
 * `@sr-receipts/host`: connect to a guest daemon, run, and read back what the
 * screen reader said. Re-exported explicitly, so the package's contract is a
 * list someone can read.
 */
export type * from "./protocol.ts";
export {
  createClient,
  readFrames,
  RigError,
  type ClientOptions,
  type RigClient,
  type RunOptions,
} from "./client.ts";
