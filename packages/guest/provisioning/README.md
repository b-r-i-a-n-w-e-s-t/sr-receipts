# Windows Guest Rig provisioning

This directory makes the setup **after** Windows first-run repeatable. It does
not create, boot, clone, checkpoint, or control a UTM VM; it does not configure
SSH or shared-folder request protocols.

## Manual bootstrap boundary

Before running the Provisioner, a maintainer manually creates an approved
Windows 11 **ARM64** guest from a CrystalFetch-built official Windows ISO,
completes Windows first-run and activation, creates and signs into the desktop
account, and installs/configures UTM guest tools as needed. Clone or otherwise
copy this repository into that signed-in user's local filesystem, then change
into its `packages\guest` directory before running the command below. The
Provisioner installs the committed lockfile from the repository root, where
npm workspaces keep it. The inspected rig
uses 4 vCPUs, 8 GiB RAM, 64 GiB storage, and UTM Shared/NAT networking. On that
network, the Mac is currently reachable from the guest at `192.168.64.1`; this
is an operational fact, not discovery or a supported UTM-control contract.

Run the Provisioner from PowerShell in that signed-in, **unlocked** desktop.
The script registers the daemon's logon task as that user at limited
privilege, and restarts it, so the daemon it proves is the one just
provisioned. Launch it unelevated; the one step that needs elevation,
the firewall rule, is `tasks\register.ps1 -Firewall`, run once afterwards:

```powershell
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1
```

NVDA and headed Edge must share the interactive desktop. Do not run this over
SSH, as a service, or while the desktop is locked. Re-running is safe: the
script verifies installed versions, uses `npm ci`, invokes Guidepup's `setup`
then `install nvda` lifecycle, and re-registers the limited, interactive
entry point. The proof itself is a client of the unelevated `nvda-daemon`
task's daemon, so the desktop it proves is the daemon's, never the
provisioning PowerShell process's.

## Runtime stages

Each manifest component is a named stage (`architecture`, `node`, `edge`,
`packages`, `guidepup-nvda`, `tasks`, `daemon`), and every outcome is recorded in the
report's `runtime` list. A stage's detail is read back off the machine, not
claimed: the installed Node version, the Edge version Windows ships, the
`@guidepup/guidepup` and `playwright-core` versions `npm ci` actually left in
`node_modules`, the NVDA asset Guidepup unpacked into its cache, and the
scheduled tasks Windows now holds with their run level. A failed stage records its error, skips the remaining stages, and
skips the NVDA proof, because there is no runtime left to prove; the report
still names the stage that failed, so a dependency failure is never confused
with a desktop, network, or speech-capture failure.

`provisioning/health-report.ts` owns the report, the proof and the probe, and
the provisioner hands it the stage record:

```powershell
node provisioning\health-report.ts <report.json> --stages <stages.json> [--host-url <url>]
```

PowerShell writes a report itself only when the reporter cannot: Node is not
installed, or the reporter died before writing a file. The previous report is
deleted before the reporter runs, so yesterday's `ok: true` can never stand in
for a report this run failed to write.

## Reviewed runtime manifest

[`runtime-manifest.json`](./runtime-manifest.json) is the review point for every
runtime version and downloaded executable hash. Node 22.18.0 is the official
ARM64 ZIP distribution; it is installed into the current user's local
application data so direct TypeScript execution needs no machine-wide MSI or
elevation, with its SHA-256 verified before installation. Edge is the browser
Windows 11 ships and the one native browser Playwright can drive on ARM64; it
is verified present, never downloaded, and its version is recorded in every
Environment Stamp rather than pinned. `playwright-core` 1.63.0 is the browser
server a Mac's Playwright connects to, which only works between the same
major.minor, so its version here is what every consumer must match. The exact
locked `@guidepup/setup` 0.25.3 installs assets selected from
`@guidepup/guidepup` 0.34.0's own manifest; the NVDA asset facts in this
manifest are a reviewed copy of that source, and the pure test asserts their
conformance. Updating any runtime means reviewing this manifest and the npm
lockfile together.

## Evidence and optional network diagnosis

With the runtime installed and the daemon restarted, provisioning always
runs `smoke.ts` as a client of that daemon: it starts NVDA through the
daemon's routes, opens `fixtures/control.html` in the daemon's browser
server, runs the Focus Guard and asks real NVDA four commands through the
same `ReaderSession` a test uses, and stops. The reporter reads the
`SmokeResult` (`lib/smoke-result.ts`) from the last line the Smoke prints,
and the Smoke writes its transcript to `artifacts/smoke-transcript.txt`. The
daemon answering with speech is the posture check: a daemon started over SSH
answers every route and hears nothing.

Every `checks` entry gates the `ok` verdict, and only they do: an installed
runtime, a daemon that answered, the Smoke's own verdict, captured speech,
and a retained non-empty transcript (`artifacts.transcript`, sized in
`observed.transcriptBytes`). The UTF-8 health report also retains the Smoke's
output and result and the reporter's runtime observations.

To diagnose a Mac-served app without making networking a provisioning
requirement:

```powershell
powershell -ExecutionPolicy Bypass -File provisioning\provision.ps1 `
  -HostUrl http://192.168.64.1:5173/
```

The report's `hostUrlProbe` records that result independently. Its failure does
not change the Provisioner's exit status or `ok` verdict, and
`test/provisioning.test.ts` holds that separation. The probe is the reporter's,
so the PowerShell fallback report records `attempted: false` while still naming
the `url` you asked about and why it went unprobed. A rig with no Node cannot
run the probe, which is not the same as nobody having asked for one.
