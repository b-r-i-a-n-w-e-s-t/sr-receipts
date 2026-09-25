# Changelog

All notable changes to `@sr-receipts/playwright`. Pre-1.0: a minor version may
break the contract.

## Unreleased (0.1.0)

- `receiptsFixtures`, for a consumer's `base.extend`: a `receipts` fixture
  whose `run(target, scenario, { assert })` asks the project's reader and
  returns the Receipt, configured by `use: { receiptsOptions: { reader, url,
  token, baseURL, budgets } }`. NVDA only.
- A FAIL verdict fails the test and lists each failed expectation and check;
  a broken run throws; a busy rig throws, naming the run in flight.
- The test's timeout is derived from the scenario, from `defaultBudgets`
  (90 seconds to open and 10 a step on NVDA) plus each step's `settle`.
- Each test attaches its transcript, environment stamp and Receipt.
