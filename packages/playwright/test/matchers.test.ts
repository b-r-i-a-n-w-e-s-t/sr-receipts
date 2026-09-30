/**
 * The speech matchers, tested without Playwright or a reader, on speech the
 * readers really produced for carbon-svelte#393 on 2026-09-29.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { readerMatchers } from "../src/matchers.ts";

const state = { isNot: false } as never;
const toAnnounce = (received: string | { spoken: string }, expected: string | RegExp) => readerMatchers.toAnnounce.call(state, received, expected);
const toAnnounceCleanly = (received: string | { spoken: string }) => readerMatchers.toAnnounceCleanly.call(state, received);

const nvdaJoined = "1 row selected. Selection actions available.. main landmark, Ready for export, region, Test, table";

test("a string matches as literal text, case-insensitively, with the period needing no escape", () => {
  assert.equal(toAnnounce(nvdaJoined, "1 row selected. Selection actions available").pass, true);
  assert.equal(toAnnounce(nvdaJoined, "1 ROW SELECTED").pass, true);
  assert.equal(toAnnounce("1 row selectedX Selection actions available", "1 row selected. Selection").pass, false);
});

test("whitespace between words is whatever the reader put there", () => {
  assert.equal(toAnnounce("1 row\n  selected", "1 row selected").pass, true);
});

test("a match never starts or ends inside a longer word or number", () => {
  assert.equal(toAnnounce("21 rows selected.", "1 rows selected").pass, false);
  assert.equal(toAnnounce("2 rows selected.", "2 row").pass, false);
  assert.equal(toAnnounce("2 rows selected.", "2 rows selected.").pass, true);
});

test("a RegExp is used as it is", () => {
  assert.equal(toAnnounce(nvdaJoined, /row selected\.\s+selection/i).pass, true);
});

test("a capture's { spoken } is accepted directly", () => {
  assert.equal(toAnnounce({ spoken: "2 rows selected." }, "2 rows selected").pass, true);
});

test("the failure message quotes what was said, and names silence", () => {
  assert.match(toAnnounce("2 rows selected.", "Selection actions available").message(), /it said: "2 rows selected\."/);
  assert.match(toAnnounce("", "anything").message(), /it said: \(silence\)/);
});

test("punctuation noise the readers really produced is found", () => {
  const nvdaDot = toAnnounceCleanly("1 row selected dot Selection actions available.. 1 row selected dot Selection actions available..");
  assert.equal(nvdaDot.pass, false);
  assert.match(nvdaDot.message(), /a symbol read as a word/);
  const voiceOverLonePeriod = toAnnounceCleanly("1 row selected . Selection actions available.");
  assert.equal(voiceOverLonePeriod.pass, false);
  assert.match(voiceOverLonePeriod.message(), /a period standing alone/);
  assert.equal(toAnnounceCleanly("1 row selected...").pass, false);
  assert.equal(toAnnounceCleanly("1 row selected…").pass, false);
});

test("NVDA's utterance joiner and ordinary sentence periods are not noise", () => {
  assert.equal(toAnnounceCleanly(nvdaJoined).pass, true);
  assert.equal(toAnnounceCleanly("Download, 1 row selected., 1 of 2").pass, true);
  assert.equal(toAnnounceCleanly("2 rows selected.. row 3, select row, check box, checked, The Rolling Stones").pass, true);
});

test("a word merely containing a symbol's name is not noise", () => {
  assert.equal(toAnnounceCleanly("Dotted line periodic report").pass, true);
});

test("anything that is neither a string nor a capture is refused", () => {
  assert.throws(() => toAnnounce(42 as never, "x"), /spoken string or a capture/);
});
