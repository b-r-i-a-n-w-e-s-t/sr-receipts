# Windows Guest Rig provisioning, proven on the guest

Run date: the session that closed [issue #3](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/issues/3).
Guest: `WIN-FPJRL6VST6T`, Windows 11 ARM64 under UTM, user `brian`, rig at
`C:\Users\brian\nvda-rig`.

## Executive finding

> [!IMPORTANT]
> **A single `provisioning\provision.ps1` run took a manually installed Windows
> 11 ARM64 guest to a rig that drives real NVDA and headed Firefox.** All eight
> report checks passed, and the retained speech log holds NVDA's actual words
> about the fixture's tables. This is the evidence for issue #3's third
> acceptance criterion; installed files alone never established it.

This was also the *first* execution of the provisioner. Its parameter defaults
referenced `$PSScriptRoot`, which Windows PowerShell has not populated when it
binds a script's defaults, so the script had always died during parameter
binding with `Join-Path : Cannot bind argument to parameter 'Path' because it
is an empty string`. Every rig `.ps1` script is now held to resolving such
paths in its body instead (`test/provisioning.test.ts`).

## The health report

Written to `provisioning\health-report.json`, reproduced verbatim except for
indentation:

```json
{
  "schemaVersion": 3,
  "ok": true,
  "fixture": "control.html",
  "execution": "unelevated interactive scheduled task: real NVDA with headed Firefox",
  "checks": {
    "runtimeInstalled": true, "taskCompleted": true, "smokePassed": true,
    "speechCaptured": true, "speechArtifact": true, "focusRetained": true,
    "scheduledCmdNode": true, "freshArtifact": true
  },
  "runtime": [
    { "name": "architecture", "ok": true, "detail": "ARM64" },
    { "name": "node", "ok": true, "detail": "v22.18.0 at C:\\Users\\brian\\AppData\\Local\\nvda-rig\\node-v22.18.0-win-arm64" },
    { "name": "firefox", "ok": true, "detail": "156.0" },
    { "name": "packages", "ok": true, "detail": "@guidepup/guidepup 0.34.0 from the committed lockfile" },
    { "name": "guidepup-nvda", "ok": true, "detail": "0.2.1-2026.2" },
    { "name": "tasks", "ok": true, "detail": "nvda-probe (Limited, Interactive), nvda-run (Limited, Interactive), nvda-smoke (Limited, Interactive)" }
  ],
  "artifacts": {
    "result": "C:\\Users\\brian\\nvda-rig\\artifacts\\smoke-result-1789591710202-2020.json",
    "speech": "C:\\Users\\brian\\nvda-rig\\artifacts\\smoke-log-1789591710202-2020.txt"
  },
  "hostUrlProbe": { "attempted": false, "ok": null, "url": null, "failure": null },
  "observed": {
    "reporterNode": "v22.18.0", "reporterPlatform": "win32",
    "reporterArchitecture": "arm64", "speechArtifactBytes": 1230,
    "smoke": {
      "node": "v22.18.0",
      "executable": "C:\\Users\\brian\\AppData\\Local\\nvda-rig\\node-v22.18.0-win-arm64\\node.exe",
      "platform": "win32", "architecture": "arm64",
      "executionPosture": "scheduled-task-cmd"
    }
  }
}
```

## What NVDA actually said

From the run's speech log, 1230 bytes, reached through the unelevated
`nvda-smoke` scheduled task:

```
title bar (NVDA+T) [perform:reportTitle] :: Control: native less table greater (validates the rig, not the component) — Mozilla Firefox
current focus (NVDA+Tab) [perform:reportCurrentFocus] :: Control: native less table greater (validates the rig, not the component), document, focused, read only
next table (T) [perform:moveToNextTable] :: Historical Structures, table, with 16 rows and 5 columns, caption, Historical Structures
next table again (T) [perform:moveToNextTable] :: Survey Staff, table, with 4 rows and 3 columns, caption, Survey Staff
```

NVDA names both fixture tables with their real row and column counts, so the
screen reader, the browser, and the accessibility tree were all live.

## Second run: idempotency

Rerunning the same command on the provisioned rig printed no `installing Node`
or `installing Firefox` line, because both version checks were already
satisfied, and every stage reported the same observations. The verdict was
`ok: true` again with a new run id (`1789591960173-5756`, against
`1789591710202-2020` for the first run) and 1230 bytes of speech, so the second
verdict rests on its own fresh NVDA run rather than the first run's artifacts.
This is issue #3's second acceptance criterion: rerunning confirms or repairs a
guest instead of requiring manual cleanup.

`npm ci` does reinstall `node_modules` from the committed lockfile on every
run. That is deliberate — it is what makes the installed tree match the
reviewed manifest rather than whatever a previous run left behind.

## Open item for the next manifest review

`npm ci` warned that a transitive dependency wants a newer Node than the
reviewed one:

```
npm warn EBADENGINE package: 'undici@8.10.2',
npm warn EBADENGINE required: { node: '>=22.19.0' },
npm warn EBADENGINE current: { node: 'v22.18.0', npm: '10.9.3' }
```

The rig works regardless, and Node's version is diagnostic-only for Baseline
Identity, so this does not invalidate the committed transcript baselines. It
does mean `runtime-manifest.json` is pinning a Node below a dependency's stated
engine floor. Resolving it means reviewing a newer 22.x ZIP with its SHA-256
alongside the lockfile, which is a manifest review, not a provisioning fix.
