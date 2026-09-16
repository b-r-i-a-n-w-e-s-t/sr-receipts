# Windows Guest Rig provisioning

This directory makes the setup **after** Windows first-run repeatable. It does
not create, boot, clone, checkpoint, or control a UTM VM; it does not configure
SSH or shared-folder request protocols.

## Manual bootstrap boundary

Before running the Provisioner, a maintainer manually creates an approved
Windows 11 **ARM64** guest from a CrystalFetch-built official Windows ISO,
completes Windows first-run and activation, creates and signs into the desktop
account, and installs/configures UTM guest tools as needed. The inspected rig
uses 4 vCPUs, 8 GiB RAM, 64 GiB storage, and UTM Shared/NAT networking. On that
network, the Mac is currently reachable from the guest at `192.168.64.1`; this
is an operational fact, not discovery or a supported UTM-control contract.

Run the Provisioner from PowerShell in that signed-in, **unlocked** desktop:

```powershell
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1
```

NVDA and headed Firefox must share the interactive desktop. Do not run this
over SSH, as a service, or while the desktop is locked. Re-running is safe: the
script verifies installed versions, uses `npm ci`, invokes Guidepup's `setup`
then `install nvda` lifecycle, and re-registers the required limited,
interactive entry points. The proof itself is always launched through the
unelevated `nvda-smoke` scheduled task—not the possibly elevated provisioning
PowerShell process.

## Reviewed runtime manifest

[`runtime-manifest.json`](./runtime-manifest.json) is the review point for every
runtime version and downloaded executable hash. Node 22.18.0 is the official
ARM64 ZIP distribution; it is installed into the current user's local
application data so direct TypeScript execution needs no machine-wide MSI or
elevation. Firefox is pinned to 156.0, the version recorded by the committed
Windows transcript baselines. Both downloads have SHA-256 values verified before
installation. The exact locked `@guidepup/setup` 0.25.3 installs assets selected
from `@guidepup/guidepup` 0.34.0's own manifest; the NVDA asset facts in this
manifest are a reviewed copy of that source, and the pure test asserts their
conformance. Updating any runtime means reviewing this manifest and the npm
lockfile together.

## Evidence and optional network diagnosis

Provisioning always runs `smoke.ts control.html`, a local fixture, through real
NVDA and headed Firefox. The task clears and recreates
`artifacts/smoke-log.txt` and `artifacts/smoke-task.out` for each proof, then
writes `provisioning/health-report.json`. Success requires a successful task, a
fresh speech artifact, and non-empty, non-silent recorded speech; installed
files or stale logs alone are not a passing rig. The report also retains task
output and Node/platform diagnostics when the smoke fails.

To diagnose a Mac-served app without making networking a provisioning
requirement:

```powershell
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1 `
  -HostUrl http://192.168.64.1:5173/
```

The report's `hostUrlProbe` records that result independently. Its failure does
not change the Provisioner's exit status or `ok` verdict.
