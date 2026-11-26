/**
 * The daemon's entry point: NVDA behind a port, and the guest's Edge behind
 * the same port's `/browser`.
 *
 * Must be started by the `nvda-daemon` scheduled task or from a terminal on
 * the guest desktop. A daemon started over SSH will accept requests, start
 * NVDA, and record a transcript of nothing at all, because an SSH session has
 * no interactive desktop for NVDA to describe. It is reachable over the
 * network and still has to run on the console.
 *
 * Configuration is environment variables, set by `tasks/register.ps1`:
 *
 *   RIG_TOKEN         required; the bearer token every request, `/browser`
 *                     included, must present
 *   RIG_PORT          default 8765
 *   RIG_HOST          default 0.0.0.0: the Mac reaches the guest across UTM's
 *                     shared network, so binding loopback would make it
 *                     unreachable. Edge's own DevTools port is loopback only.
 *
 *   node daemon.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, createRigServer, resolveToken } from "./lib/daemon.ts";
import { createEdge } from "./lib/edge.ts";
import { EDGE, createNvdaDesktop } from "./lib/nvda.ts";

let token: string;
let generated: boolean;
try {
  ({ token, generated } = resolveToken({ token: process.env.RIG_TOKEN, interactive: process.stdout.isTTY === true }));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const port = Number(process.env.RIG_PORT ?? DEFAULT_PORT);
const host = process.env.RIG_HOST ?? "0.0.0.0";
const desktop = createNvdaDesktop();

// Task Scheduler ends only the task's own process, the cmd wrapper, and
// leaves this one holding the port. run-daemon.cmd reads this file and ends
// the previous daemon before starting the next, so a task restart is a
// restart.
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/daemon.pid", `${process.pid}\n`, "utf8");

// The installed Edge, headed: NVDA has to have a window to read. Its profile
// is its own, apart from the signed-in user's Edge, and kept across restarts
// so its first-run prompts are answered once. Started now, so a broken Edge
// is in this log and in /health before any test asks for it.
const edge = createEdge({ executable: EDGE, profile: join(process.env.LOCALAPPDATA ?? ".", "nvda-rig", "edge-profile") });
const browser = await edge.health();

// The stamp is taken once and kept, so this also takes the one every
// transcript this daemon serves will carry.
const environment = await desktop.environment();

const server = createRigServer({ token, desktop, edge });

/** Where the Mac should point, since nothing records how it addresses the guest. */
const addresses = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4" && !address.internal)
    .map((address) => address?.address as string);

server.listen(port, host, () => {
  console.log(`nvda-rig daemon listening on ${host}:${port}, the guest's Edge on its /browser`);
  if (!browser.running) console.log(`  but Edge is not running: ${browser.error}`);
  // The stamp is what heads every transcript, so printing it at startup means
  // the daemon's log says which NVDA and Edge the tests it serves will use.
  for (const line of environment) console.log(`  ${line}`);

  console.log("\nFrom the Mac:");
  for (const address of addresses()) {
    console.log(`  RIG_URL=http://${address}:${port}`);
  }
  console.log(`  RIG_TOKEN=${token}${generated ? "   (generated for this run)" : ""}`);
  if (generated) console.log("\nSet RIG_TOKEN yourself to keep the same token across restarts.");
  console.log("\nLeave this window open and logged in. NVDA needs the console desktop:");
  console.log("a locked session is fine, a signed-out one is not.");
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n${signal}: closing.`);
  await desktop.stop().catch(() => undefined);
  // Ending Edge ends every connection piped to it, which the server waits for.
  await edge.close().catch(() => undefined);
  server.close(() => process.exit(0));
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
