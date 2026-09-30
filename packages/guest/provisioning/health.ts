import { SMOKE_CONTROL_FIXTURE, type SmokeResult } from "../lib/smoke-result.ts";

export const HEALTH_REPORT_SCHEMA_VERSION = 5;
export const PROVISION_EXECUTION =
  "the logon daemon, as a test uses it: real NVDA and headed Edge through the daemon's routes and browser server";

/**
 * One reviewed Runtime Manifest step. The PowerShell provisioner records each
 * outcome instead of throwing, so the report can tell a dependency failure
 * apart from a desktop, network or speech-capture failure.
 */
export interface ProvisioningStage {
  name: string;
  ok: boolean;
  detail: string;
}

/** Diagnosis of the guest's reach to a Mac-served URL. Never a gate. */
export interface HostUrlProbe {
  attempted: boolean;
  ok: boolean | null;
  url: string | null;
  failure: string | null;
}

export const NO_HOST_URL_PROBE: HostUrlProbe = {
  attempted: false,
  ok: null,
  url: null,
  failure: null,
};

export const PROBE_TIMEOUT_MS = 10_000;

/**
 * `fetch` reports every network failure as "fetch failed" and hides the reason
 * in `cause`, which is the only part a maintainer can act on: a refused
 * connection means no dev server, a timeout means the guest cannot route to
 * the Mac at all.
 */
function describe(error: Error): string {
  const cause = error.cause instanceof Error ? error.cause.message : error.cause;
  return cause ? `${error.message}: ${cause}` : error.message;
}

/** Diagnose the guest's reach to a Mac-served URL. Reported, never a gate. */
export async function probeHostUrl(url: string | undefined): Promise<HostUrlProbe> {
  if (!url) return NO_HOST_URL_PROBE;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return {
      attempted: true,
      ok: response.ok,
      url,
      failure: response.ok ? null : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return { attempted: true, ok: false, url, failure: describe(error as Error) };
  }
}

/** Where the Smoke's transcript, the log a maintainer reads, was written. */
export interface SmokeArtifacts {
  transcript: string;
}

export interface HealthReport {
  schemaVersion: typeof HEALTH_REPORT_SCHEMA_VERSION;
  ok: boolean;
  fixture: typeof SMOKE_CONTROL_FIXTURE;
  execution: typeof PROVISION_EXECUTION;
  checks: {
    runtimeInstalled: boolean;
    daemonAnswered: boolean;
    smokePassed: boolean;
    speechCaptured: boolean;
    transcriptArtifact: boolean;
  };
  runtime: ProvisioningStage[];
  artifacts: SmokeArtifacts;
  hostUrlProbe: HostUrlProbe;
  observed: {
    reporterNode: string;
    reporterPlatform: string;
    reporterArchitecture: string;
    transcriptBytes: number;
    smokeOutput: string;
    smoke?: SmokeResult;
  };
  failure?: string;
}

export interface ProvisioningEvidence {
  runtime: ProvisioningStage[];
  smoke: SmokeResult | undefined;
  artifacts: SmokeArtifacts;
  hostUrlProbe: HostUrlProbe;
  observed: HealthReport["observed"];
  failure?: string | undefined;
}

export function assessProvisioning({ runtime, smoke, artifacts, hostUrlProbe, observed, failure }: ProvisioningEvidence): HealthReport {
  const checks: HealthReport["checks"] = {
    // An empty stage list is no evidence, not a pass.
    runtimeInstalled: runtime.length > 0 && runtime.every((stage) => stage.ok),
    // The daemon is the posture: only the logon task's daemon, on the
    // interactive desktop, can answer with speech. An SSH-started one
    // answers every route and hears nothing.
    daemonAnswered: smoke?.daemon === true,
    smokePassed: smoke?.ok === true,
    // Whether speech was heard; `transcriptArtifact` is only whether the log
    // a maintainer reads survived the run. The two fail for different reasons.
    speechCaptured: (smoke?.spoke ?? 0) > 0,
    transcriptArtifact: observed.transcriptBytes > 0,
  };
  return {
    schemaVersion: HEALTH_REPORT_SCHEMA_VERSION,
    // Every check gates, and only checks gate: the host URL probe is reported
    // beside the verdict, never inside it.
    ok: Object.values(checks).every(Boolean),
    fixture: SMOKE_CONTROL_FIXTURE,
    execution: PROVISION_EXECUTION,
    checks,
    runtime,
    artifacts,
    hostUrlProbe,
    observed,
    ...(failure ? { failure } : {}),
  };
}
