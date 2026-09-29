/**
 * The rig's smoke test: does NVDA start, does Edge open a page, do the guards
 * reach the document in browse mode, and does quick navigation answer, on this
 * machine right now?
 *
 * This is the only check on the guest that exercises the guards and the NVDA
 * lifecycle for real, on a fixture of its own so it can say "the rig itself is
 * fine" whatever the state of any app. `npm test` covers the sequencing
 * against a fake desktop, and nothing that needs a real one.
 *
 *   node smoke.ts
 *
 * Triggering it over plain SSH does not work: the run has to be started by the
 * `nvda-smoke` scheduled task, registered with an interactive logon so it
 * lands in the console session. The Provisioner does that.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { createNvdaDesktop, enterDocument } from "./lib/index.ts";
import { SMOKE_CONTROL_FIXTURE, SMOKE_RESULT_SCHEMA_VERSION, type SmokeRequest, type SmokeResult } from "./lib/smoke-result.ts";

const COMMANDS = ["reportTitle", "reportCurrentFocus", "moveToNextTable", "moveToNextTable"];

function smokeRequest(): SmokeRequest | undefined {
  const path = process.env.RIG_SMOKE_REQUEST ?? "artifacts/smoke-request.json";
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SmokeRequest;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const request = smokeRequest();
const fixture = pathToFileURL(join(import.meta.dirname, "fixtures", SMOKE_CONTROL_FIXTURE)).href;
const desktop = createNvdaDesktop();
const out = [`# smoke on ${SMOKE_CONTROL_FIXTURE}`, "", ...desktop.environment(), ""];
let ok = false;
let completedSteps = 0;
let speechCaptured = false;
let failure: string | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let started = false;

try {
  browser = await chromium.launch({ channel: "msedge", headless: false });
  const page = await browser.newPage();
  await page.goto(fixture, { waitUntil: "load" });
  await desktop.start();
  started = true;

  const entry = await enterDocument(desktop, { pageTitle: await page.title() });
  out.push(...entry.lines, "");
  if (entry.ok) {
    for (const command of COMMANDS) {
      const heard = await desktop.perform(command);
      console.log(`${command} :: ${heard || "(silence)"}`);
      out.push(`### ${command}`, heard || "(silence)", "");
      completedSteps += 1;
      if (heard) speechCaptured = true;
    }
    // The smoke asserts only that the rig works: NVDA started, the page was
    // reached, and quick navigation answered. What it answered with is a
    // test's business.
    ok = completedSteps === COMMANDS.length && speechCaptured;
  }
} catch (error) {
  const caught = error as Error;
  failure = caught?.message ?? String(error);
  console.error("FAILED:", caught?.message);
  console.error("CAUSE:", (caught?.cause as Error)?.message ?? caught?.cause ?? "(none)");
  out.push("### error", caught?.message ?? "", (caught?.cause as Error)?.message ?? "");
} finally {
  const artifact = resolve(request?.speech ?? process.env.RIG_SMOKE_ARTIFACT ?? "artifacts/smoke-log.txt");
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, out.join("\n") + "\n", "utf8");
  if (started) {
    try {
      await desktop.stop();
    } catch (error) {
      failure ??= (error as Error).message;
      ok = false;
    }
  }
  await browser?.close().catch(() => undefined);
  const result: SmokeResult = {
    schemaVersion: SMOKE_RESULT_SCHEMA_VERSION,
    runId: request?.runId ?? null,
    fixture: SMOKE_CONTROL_FIXTURE,
    ok,
    expectedSteps: COMMANDS.length,
    completedSteps,
    speechCaptured,
    focusLost: null,
    error: failure,
    observed: {
      node: process.version,
      executable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
      executionPosture: process.env.RIG_EXECUTION_POSTURE ?? null,
    },
  };
  const resultArtifact = resolve(request?.result ?? "artifacts/smoke-result.json");
  mkdirSync(dirname(resultArtifact), { recursive: true });
  writeFileSync(resultArtifact, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(ok ? "\nSMOKE OK" : `\nSMOKE FAILED, see ${artifact}`);
  process.exitCode = ok ? 0 : 1;
}
