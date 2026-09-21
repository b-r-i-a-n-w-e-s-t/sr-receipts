# sr-receipts

Receipts for what a screen reader actually said. sr-receipts runs real screen
readers against web content on the desktop each reader has to live on, records
their speech as evidence, and compares it against committed baselines.

It is two private workspace packages, each independently versioned and
changelogged. Neither is published to a registry.

| Package | Owns | Runs on |
|---|---|---|
| [`@sr-receipts/host`](packages/host/README.md) | Connecting to a guest daemon with an endpoint and bearer token, starting runs, and reading back reports, events and artifacts. Owns the wire types. | The Mac you develop on |
| [`@sr-receipts/guest`](packages/guest/README.md) | The authenticated daemon, one run at a time on the interactive desktop, scenarios, verdicts, snapshots, transcripts, the Execution Targets, and the Windows Guest Rig Provisioner | The machine the screen reader runs on |

The guest depends on the host for the protocol. The host never depends on the
guest, so nothing Mac-facing carries a screen reader's vocabulary.

Terms used across both packages are defined in [`CONTEXT.md`](CONTEXT.md).

## Working in the repository

```bash
npm ci      # at the repository root: installs both packages from one lockfile
npm test    # every package's tests, then a typecheck of the whole repository
```

Real-reader runs happen from the guest package. See its README for NVDA on the
Windows Guest Rig, and [`packages/guest/voiceover`](packages/guest/voiceover/README.md)
for VoiceOver with Safari on a local Mac.

## Moving an existing guest to this layout

The guest runtime moved from the repository root to `packages/guest`. On a
Windows Guest Rig provisioned before the move, re-run the Provisioner from
`packages\guest` so `npm ci` runs at the root and the scheduled tasks are
re-registered at their new paths:

```powershell
cd packages\guest
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1
```
