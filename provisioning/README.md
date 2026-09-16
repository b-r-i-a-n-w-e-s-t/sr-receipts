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
script verifies installed versions, uses `npm ci`, and Guidepup reuses its
registered portable NVDA installation.

## Reviewed runtime manifest

[`runtime-manifest.json`](./runtime-manifest.json) is the review point for every
runtime version and downloaded executable hash. Node and Firefox are ARM64
installer URLs whose SHA-256 values are verified before installation. The exact
locked `@guidepup/setup` version supplies Guidepup's tagged portable NVDA asset;
the asset tag and archive SHA-256 are recorded for review. Updating any runtime
means reviewing this manifest and the npm lockfile together.

## Evidence and optional network diagnosis

Provisioning always runs `smoke.ts control.html`, a local fixture, through real
NVDA and headed Firefox. It writes `smoke-log.txt` (the speech artifact) and
`provisioning/health-report.json`. Success requires both a successful smoke
exit and non-empty, non-silent recorded speech; installed files alone are not a
passing rig.

To diagnose a Mac-served app without making networking a provisioning
requirement:

```powershell
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1 `
  -HostUrl http://192.168.64.1:5173/
```

The report's `hostUrlProbe` records that result independently. Its failure does
not change the Provisioner's exit status or `ok` verdict.
