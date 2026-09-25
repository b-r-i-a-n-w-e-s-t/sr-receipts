/**
 * The `receipts` fixture: Playwright Test as runner, reporter and
 * configuration, with no `page`. The reader, its real browser, the guards and
 * the verdict stay behind the Execution Target seam on the guest; see ADR 0001.
 *
 * Exported as fixtures for the consumer's own `test.extend`, and importing only
 * types from `@playwright/test`. Playwright refuses to load a second copy of
 * itself, and a linked package resolves its imports from where it really
 * lives, which is not the consumer's `node_modules`.
 */
import type { Fixtures } from "@playwright/test";
import { createClient, RigError, type Reader, type Receipt, type Scenario } from "@sr-receipts/host";

import { assertReader, defaultBudgets, findings, resolveTarget, timeoutFor, type Budgets } from "./receipts.ts";

/** A project's `use: { receiptsOptions }`. */
export interface ReceiptsOptions {
  reader: Reader;
  /** The guest daemon's base URL. */
  url: string;
  token: string;
  /** What a path target is joined to: the address the guest reaches the host by. */
  baseURL?: string;
  /** Overrides this reader's default budgets. */
  budgets?: Partial<Budgets>;
}

export interface ReceiptsRunOptions {
  /**
   * `false` returns the Receipt whatever its verdict, for an investigation that
   * wants the transcript. A run that broke still throws.
   */
  assert?: boolean;
}

export interface Receipts {
  /**
   * Run one scenario against one target on this project's reader, and return
   * the Receipt. Fails the test on findings unless `assert` is false.
   */
  run(target: string, scenario: Scenario, options?: ReceiptsRunOptions): Promise<Receipt>;
}

/** `test.extend(receiptsFixtures)` gives a test the `receipts` fixture. */
export const receiptsFixtures: Fixtures<{ receipts: Receipts }, { receiptsOptions: ReceiptsOptions | undefined }> = {
  receiptsOptions: [undefined, { option: true, scope: "worker" }],

  receipts: async ({ receiptsOptions }, use, testInfo) => {
    if (!receiptsOptions) {
      throw new Error("this project has no receiptsOptions: set use.receiptsOptions in its Playwright config");
    }
    const { reader, url, token, baseURL, budgets } = receiptsOptions;
    if (reader !== "nvda") throw new Error(`reader ${reader} is not supported by @sr-receipts/playwright yet`);
    const rig = createClient({ url, token });

    await use({
      async run(target, scenario, { assert = true } = {}) {
        assertReader(scenario, reader);
        testInfo.setTimeout(timeoutFor(scenario, { ...defaultBudgets[reader], ...budgets }));

        let report;
        try {
          report = await rig.run([{ target: resolveTarget(target, baseURL), scenario }], { snapshots: "off" });
        } catch (error) {
          // A busy rig is not worth waiting for: the run in flight can take an
          // hour, and a test that waits looks exactly like a hung one.
          if (error instanceof RigError && error.status === 409) {
            const { runId } = (error.body ?? {}) as { runId?: string };
            throw new Error(`the rig is busy with run ${runId ?? "(unknown)"}; one run at a time`, { cause: error });
          }
          throw error;
        }

        const receipt = report.results[0];
        if (!receipt) throw new Error(`run ${report.runId} returned no Receipt`);
        await testInfo.attach("transcript", { body: receipt.transcript.text, contentType: "text/plain" });
        await testInfo.attach("environment", { body: receipt.environment.join("\n"), contentType: "text/plain" });
        await testInfo.attach("receipt", { body: JSON.stringify(receipt, null, 2), contentType: "application/json" });

        if (assert && !receipt.ok) throw new Error(findings(receipt));
        return receipt;
      },
    });
  },
};
