/**
 * The NVDA desktop against a fake Guidepup.
 *
 * What is worth proving without NVDA: that a command's answer is that
 * command's speech and nothing else, that an unknown command is refused before
 * a keystroke goes anywhere, and that the capture window is really open when
 * `captureBegin` returns, which is the whole point of the two-route design.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createNvdaDesktop, type GuidepupNvda } from "../lib/nvda.ts";

interface Fake extends GuidepupNvda {
  calls: string[];
  log: string[];
}

function fakeGuidepup(): Fake {
  const calls: string[] = [];
  const log: string[] = [];
  const speak = (phrase: string) => log.push(phrase);
  return {
    calls,
    log,
    keyboardCommands: { reportTitle: { key: "t" }, moveToNextTable: { key: "T" } },
    async start(options) {
      calls.push(`start ${JSON.stringify(options)}`);
    },
    async stop() {
      calls.push("stop");
    },
    async perform(command) {
      calls.push(`perform ${JSON.stringify(command)}`);
      speak((command as { key: string }).key === "t" ? "Control, Mozilla" : "");
    },
    async press(key) {
      calls.push(`press ${key}`);
      speak("");
    },
    async next() {
      calls.push("next");
      speak("row 2");
    },
    async previous() {
      calls.push("previous");
      speak("row 1");
    },
    lastSpokenPhrase: async () => log.at(-1) ?? "",
    spokenPhraseLog: async () => log,
    async clearSpokenPhraseLog() {
      log.length = 0;
    },
    async capture(action) {
      calls.push("capture: listener attached");
      const result = await action();
      calls.push("capture: action done, settling");
      return { spokenPhrase: "1 row selected", result };
    },
  };
}

test("a command answers with its own speech, and silence is an empty string", async () => {
  const guidepup = fakeGuidepup();
  const desktop = createNvdaDesktop({ reader: guidepup, environment: async () => [] });
  assert.equal(await desktop.perform("reportTitle"), "Control, Mozilla");
  assert.equal(await desktop.perform("moveToNextTable"), "");
  assert.equal(await desktop.press("Control+Home"), "");
  assert.equal(await desktop.next(), "row 2");
  assert.deepEqual(guidepup.calls, ['perform {"key":"t"}', 'perform {"key":"T"}', "press Control+Home", "next"]);
});

test("an unknown command is refused before any keystroke is sent", async () => {
  const guidepup = fakeGuidepup();
  const desktop = createNvdaDesktop({ reader: guidepup, environment: async () => [] });
  await assert.rejects(async () => desktop.perform("moveToNextTabel"), /unknown NVDA keyboard command: moveToNextTabel/);
  assert.deepEqual(guidepup.calls, []);
});

test("start passes the rig's options: whole announcements, no speech viewer", async () => {
  const guidepup = fakeGuidepup();
  await createNvdaDesktop({ reader: guidepup, environment: async () => [] }).start();
  assert.match(guidepup.calls[0] ?? "", /"capture":true/);
  assert.match(guidepup.calls[0] ?? "", /"showSpeechViewerAtStartup":false/);
});

test("captureBegin returns only once Guidepup's listener is attached, and captureEnd returns what was said", async () => {
  const guidepup = fakeGuidepup();
  const desktop = createNvdaDesktop({ reader: guidepup, environment: async () => [] });
  await desktop.captureBegin();
  // The window is open: the listener was attached before begin returned, and
  // the action inside is still waiting for end.
  assert.deepEqual(guidepup.calls, ["capture: listener attached"]);
  assert.equal(await desktop.captureEnd(), "1 row selected");
  assert.deepEqual(guidepup.calls, ["capture: listener attached", "capture: action done, settling"]);
});

test("a second begin while one is open, or an end with none open, is refused", async () => {
  const desktop = createNvdaDesktop({ reader: fakeGuidepup(), environment: async () => [] });
  await assert.rejects(desktop.captureEnd(), /no capture is open/);
  await desktop.captureBegin();
  await assert.rejects(desktop.captureBegin(), /already open/);
  await desktop.captureEnd();
});

test("the desktop's window list and activation run the PowerShell it is given", async () => {
  const scripts: string[] = [];
  const desktop = createNvdaDesktop({
    reader: fakeGuidepup(),
    environment: async () => [],
    browserProcess: "msedge",
    powershell: async (script) => {
      scripts.push(script);
      return script.includes("SetForegroundWindow") ? "Component Library - Microsoft Edge" : "msedge: Component Library\r\nCode: repo [Administrator]";
    },
  });
  assert.deepEqual(await desktop.windows(), ["msedge: Component Library", "Code: repo [Administrator]"]);
  assert.equal(await desktop.activateBrowser(), "Component Library - Microsoft Edge");
  assert.match(scripts[1] ?? "", /Get-Process msedge/);
});

test("the environment stamp is taken once and kept", async () => {
  let taken = 0;
  const desktop = createNvdaDesktop({ reader: fakeGuidepup(), environment: async () => [`stamp ${++taken}`] });
  assert.deepEqual(await desktop.environment(), ["stamp 1"]);
  assert.deepEqual(await desktop.environment(), ["stamp 1"]);
});
