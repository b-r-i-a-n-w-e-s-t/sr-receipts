/**
 * The daemon's entry point: wire the server to the real rig and listen.
 *
 * Must be started by the `nvda-daemon` scheduled task, for exactly the reason a
 * run must — see `lib/session.ts`. A daemon started over SSH will accept
 * requests, start NVDA, and record a transcript of nothing at all, because an
 * SSH session has no interactive desktop for NVDA to describe. It is reachable
 * over the network and still has to run on the console.
 *
 * Configuration is three environment variables, set by `tasks/register.ps1`:
 *
 *   RIG_TOKEN   required; the bearer token every request must present
 *   RIG_PORT    default 8765
 *   RIG_HOST    default 0.0.0.0 — the host reaches the guest across UTM's
 *               shared network, so binding loopback would make it unreachable
 *
 *   node daemon.ts
 */
import { networkInterfaces } from "node:os";
import {
  createRigServer,
  DEFAULT_PORT,
  executeRun,
  newRunId,
  nvdaTarget,
  resolveToken,
  runDir,
} from "./lib/index.ts";

let token: string;
let generated: boolean;
try {
  // Started by hand with no RIG_TOKEN, it makes one and prints it — the common
  // case, and not worth inventing a secret for. Started by the scheduled task
  // with no RIG_TOKEN, it refuses, because a generated token nobody can read is
  // a daemon nothing can talk to.
  ({ token, generated } = resolveToken({
    token: process.env.RIG_TOKEN,
    interactive: process.stdout.isTTY === true,
  }));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const port = Number(process.env.RIG_PORT ?? DEFAULT_PORT);
const host = process.env.RIG_HOST ?? "0.0.0.0";

const server = createRigServer({
  token,
  execute: (options) => executeRun(nvdaTarget, options),
  runDir,
  newRunId,
  stamp: () => nvdaTarget.environment(),
});

/** Where the host should point, since nothing records how it addresses the guest. */
const addresses = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4" && !address.internal)
    .map((address) => address?.address as string);

server.listen(port, host, () => {
  console.log(`nvda-rig daemon listening on ${host}:${port}`);
  // The stamp is what heads every transcript, so printing it at startup means
  // the daemon's log says which NVDA and Firefox the runs it serves will use.
  for (const line of nvdaTarget.environment()) console.log(`  ${line}`);

  console.log("\nFrom the host:");
  for (const address of addresses()) console.log(`  RIG_URL=http://${address}:${port}`);
  console.log(`  RIG_TOKEN=${token}${generated ? "   (generated for this run)" : ""}`);
  if (generated) {
    console.log("\nSet RIG_TOKEN yourself to keep the same token across restarts.");
  }
  console.log("\nLeave this window open and logged in. NVDA needs the console desktop:");
  console.log("a locked session is fine, a signed-out one is not.");
});

const shutdown = (signal: string): void => {
  console.log(`\n${signal} — closing. A run in flight is left to finish.`);
  server.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
