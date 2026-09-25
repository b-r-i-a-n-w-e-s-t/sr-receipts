/**
 * `@sr-receipts/playwright`: a `receipts` fixture for Playwright Test, which
 * asks a real screen reader on its own desktop and returns the Receipt.
 * Re-exported explicitly, so the package's contract is a list someone can read.
 */
export { receiptsFixtures, type Receipts, type ReceiptsOptions, type ReceiptsRunOptions } from "./fixture.ts";
export { defaultBudgets, type Budgets } from "./receipts.ts";
export type { Receipt, Scenario } from "@sr-receipts/host";
