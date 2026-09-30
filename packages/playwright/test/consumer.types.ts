/**
 * A consumer's spec, type-checked by `npm test`'s `tsc` and never run: the
 * package's documented setup has to give a test `reader` and `readerOptions`
 * beside Playwright's own fixtures, and `expect` the reader matchers.
 * Playwright's `extend` cannot infer fixture types from an object it is
 * handed, so a setup that relies on inference type-checks here or nowhere.
 */
import { test as base, expect as baseExpect } from "@playwright/test";
import { readerMatchers, withReader } from "../src/index.ts";

const test = withReader(base);
const expect = baseExpect.extend(readerMatchers);

test.use({ readerOptions: { reader: "voiceover" } });

test("a consumer's test has the reader beside the page", async ({ page, reader }) => {
  await reader.enter(page);
  const captured = await reader.capture(() => page.getByRole("button").focus());
  expect(captured).toAnnounce("button");
  expect(captured.spoken).toAnnounceCleanly();
  expect(await reader.next()).not.toAnnounce(/silence/);
});
