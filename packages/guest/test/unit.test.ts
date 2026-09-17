/**
 * The parts of the rig that can be tested without NVDA, a desktop or a browser.
 *
 * Run: npm test
 *
 * These cover the logic the Phase 1 extraction moved or changed: queue parsing,
 * target resolution, step-spec parsing, and the speech-log cursor that replaced
 * `.at(-1)`. The guards and the session lifecycle can only be exercised against
 * a real NVDA on the interactive desktop; that is what `npm run smoke` is for.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { parseQueue, resolveTarget, SETTLE } from "../lib/target.ts";
import { PROFILE, XULSTORE, writeWindowGeometry } from "../lib/firefox.ts";
import { toAction } from "../lib/steps.ts";
import { SpeechLog } from "../lib/speech.ts";
import type { SpeechSource } from "../lib/speech.ts";
import type { NvdaCommand, NvdaDriver, RunRequest, StepSpec } from "../lib/types.ts";

/**
 * Deliberately-invalid input, cast so it compiles.
 *
 * TypeScript now rejects most of these at author time, which is the point of
 * Phase 3.5 — but the runtime validators still have to fire, because a scenario
 * can arrive as `probe.json`, as a `.json` file under `scenarios/`, or from a
 * consuming repo that never ran tsc. Every use of this helper marks a case the
 * compiler catches for a TypeScript author and the validator catches for
 * everyone else.
 */
const invalid = <T>(value: unknown): T => value as T;

const targets = (requests: RunRequest[]): string[] => requests.map((r) => r.target);

test("parseQueue skips blanks and comments", () => {
  const queue = parseQueue(
    ["# a comment", "", "control.html", "   ", "  # indented comment", "https://x/y"].join("\n"),
  );
  assert.deepEqual(targets(queue), ["control.html", "https://x/y"]);
});

test("parseQueue handles CRLF, which is what an editor in the guest writes", () => {
  assert.deepEqual(targets(parseQueue("a.html\r\nb.html\r\n")), ["a.html", "b.html"]);
});

test("resolveTarget passes a URL through and settles longer for it", () => {
  const t = resolveTarget("http://192.168.64.1:5173/docs/column-list");
  assert.equal(t.url, "http://192.168.64.1:5173/docs/column-list");
  assert.equal(t.settle, SETTLE.url);
  assert.match(t.provenance, /no local bytes to hash/);
  // The slug becomes a file name, so it must survive NTFS.
  assert.doesNotMatch(t.slug, /[\\/:*?"<>|]/);
});

test("resolveTarget hashes a fixture's bytes the way git does", () => {
  const t = resolveTarget("control.html");
  assert.match(t.url, /^file:\/\/\/.*\/fixtures\/control\.html$/);
  assert.equal(t.settle, SETTLE.fixture);
  assert.match(t.provenance, /^fixture git blob: [0-9a-f]{40}$/);
});

/**
 * A fake driver. Possible to write honestly only because `NvdaDriver` is the
 * three members the rig actually uses, rather than guidepup NVDA class entire.
 */
interface FakeNvda extends NvdaDriver {
  keyboardCommands: Record<NvdaCommand, unknown>;
  performed: unknown[];
  pressed: string[];
  perform(command: unknown): void;
  press(key: string): void;
}

const makeFakeNvda = (): FakeNvda => ({
  keyboardCommands: { reportTitle: Symbol("reportTitle") } as unknown as Record<
    NvdaCommand,
    unknown
  >,
  performed: [],
  pressed: [],
  perform(command: unknown) {
    this.performed.push(command);
  },
  press(key: string) {
    this.pressed.push(key);
  },
});

const fakeNvda = makeFakeNvda();

test("toAction resolves both spec forms", async () => {
  const nvda = makeFakeNvda();
  await toAction(nvda, "perform:reportTitle")();
  await toAction(nvda, "press:Control+Home")();
  assert.deepEqual(nvda.performed, [nvda.keyboardCommands.reportTitle]);
  assert.deepEqual(nvda.pressed, ["Control+Home"]);
});

test("toAction rejects a misspelled command instead of silently doing nothing", () => {
  // nvda.perform(undefined) is the failure mode this replaces: it produces a
  // silence that reads in a transcript exactly like a real one.
  //
  // Both of these now fail to compile for a TypeScript author — tsc even
  // suggests "moveToNextTable" for the typo — so they are cast past the type
  // system here. The runtime check is what catches them in a JSON scenario.
  assert.throws(
    () => toAction(fakeNvda, invalid<StepSpec>("perform:moveToNextTabel")),
    /unknown NVDA keyboard command/,
  );
  assert.throws(
    () => toAction(fakeNvda, invalid<StepSpec>("moveToNextTable")),
    /bad step spec/,
  );
});

test("toAction passes a function through", async () => {
  let ran = false;
  await toAction(fakeNvda, () => {
    ran = true;
  })();
  assert.equal(ran, true);
});

/** A fake whose log grows cumulatively, which is the behaviour that bit us. */
function fakeSpeechSource(...batches: string[][]): SpeechSource {
  const log: string[] = [];
  const queue = [...batches];
  return {
    async spokenPhraseLog() {
      const next = queue.shift();
      if (next) log.push(...next);
      return [...log];
    },
  };
}

test("SpeechLog returns a whole multi-phrase announcement, not just the last phrase", async () => {
  const speech = new SpeechLog(
    fakeSpeechSource(["Description", "column 2", "Norman keep with crenellations"]),
  );
  assert.equal(
    await speech.heard(),
    "Description\ncolumn 2\nNorman keep with crenellations",
  );
});

test("SpeechLog only reports phrases new since the last look", async () => {
  const speech = new SpeechLog(fakeSpeechSource(["first"], ["second", "third"]));
  assert.equal(await speech.heard(), "first");
  assert.equal(await speech.heard(), "second\nthird");
});

test("SpeechLog names silence explicitly", async () => {
  const speech = new SpeechLog(fakeSpeechSource(["something"], []));
  await speech.heard();
  assert.equal(await speech.heard(), "(silence)");
});

test("SpeechLog treats a blank phrase as silence, not as speech", async () => {
  // NVDA emits empty phrases: observed in focus mode on a page whose focused
  // object reports an object-replacement character. Before this was handled,
  // heard() returned "" rather than SILENCE, the focus guard's
  // `heard !== SILENCE` test read a silent mode probe as proof of browse mode,
  // and a whole run proceeded in focus mode recording 60 blank steps.
  const speech = new SpeechLog(fakeSpeechSource([""], ["  ", ""], ["real", ""]));
  assert.equal(await speech.heard(), "(silence)");
  assert.equal(await speech.heard(), "(silence)");
  assert.equal(await speech.heard(), "real");
});

test("discard moves the cursor without reporting", async () => {
  const speech = new SpeechLog(fakeSpeechSource(["noise from launching firefox"], ["the answer"]));
  await speech.discard();
  assert.equal(await speech.heard(), "the answer");
});

test("a window size is written where Firefox reads it, and cleared when not asked for", () => {
  // Firefox has no flag for window size; xulstore.json is where it persists the
  // geometry. `sizemode: normal` is what stops it opening maximized and
  // ignoring the width entirely.
  mkdirSync(PROFILE, { recursive: true });

  writeWindowGeometry({ width: 1120, height: 1000 });
  const stored = JSON.parse(readFileSync(XULSTORE, "utf8"));
  const main = stored["chrome://browser/content/browser.xhtml"]["main-window"];
  assert.deepEqual(main, {
    screenX: "0",
    screenY: "0",
    width: "1120",
    height: "1000",
    sizemode: "normal",
  });

  // Every launch writes this, so a narrow scenario must not leave its width
  // behind for the next target in the queue.
  writeWindowGeometry(undefined);
  assert.equal(existsSync(XULSTORE), false);

  // And clearing an already-clear profile is not an error.
  writeWindowGeometry(undefined);
});
