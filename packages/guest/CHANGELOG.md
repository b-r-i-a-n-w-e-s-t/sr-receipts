# Changelog

All notable changes to `@sr-receipts/guest`. Pre-1.0: a minor version may break
the contract.

## Unreleased

- Firefox's address bar is kept out of snapshots. It announces the target's
  location, the checkout path or the host's address, which failed every
  control-fixture baseline after the move into `packages/guest`. The committed
  baselines drop those steps; the rest of the toolbar is still compared.

## 0.1.0

First version as its own package, extracted from the single-repository NVDA
rig. The NVDA runtime, daemon, Provisioner and VoiceOver smoke moved under
`packages/guest` unchanged in behaviour, except as listed.

- The run layer drives an `ExecutionTarget` (`lib/execution-target.ts`) rather
  than NVDA directly. `nvdaTarget` is the NVDA implementation, and `runner.ts`
  and `daemon.ts` pass it in.
- **Breaking:** `executeRun(target, options, paths?)` replaces
  `executeRun(options)`.
- **Breaking:** the host client and wire types moved to `@sr-receipts/host`.
  The wire types are still re-exported from `lib/types.ts`.
- A run whose scenarios fail to load no longer stops NVDA and kills Firefox,
  because it never started them.
- The Provisioner runs `npm ci` and reads Guidepup from the repository root,
  where npm workspaces install them. A guest provisioned before this version
  must be re-provisioned so its scheduled tasks point at `packages/guest`.
