import {
  SMOKE_CONTROL_FIXTURE,
  SMOKE_RESULT_SCHEMA_VERSION,
  SCHEDULED_TASK_POSTURE,
  type SmokeArtifacts,
  type SmokeResult,
} from "../lib/smoke-result.ts";

export const HEALTH_REPORT_SCHEMA_VERSION = 3;
export const PROVISION_EXECUTION =
  "unelevated interactive scheduled task: real NVDA with headed Firefox";

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

export interface HealthReport {
  schemaVersion: typeof HEALTH_REPORT_SCHEMA_VERSION;
  ok: boolean;
  fixture: typeof SMOKE_CONTROL_FIXTURE;
  execution: typeof PROVISION_EXECUTION;
  checks: {
    runtimeInstalled: boolean;
    taskCompleted: boolean;
    smokePassed: boolean;
    speechCaptured: boolean;
    speechArtifact: boolean;
    focusRetained: boolean;
    scheduledCmdNode: boolean;
    freshArtifact: boolean;
  };
  runtime: ProvisioningStage[];
  artifacts: SmokeArtifacts;
  hostUrlProbe: HostUrlProbe;
  observed: {
    reporterNode: string;
    reporterPlatform: string;
    reporterArchitecture: string;
    speechArtifactBytes: number;
    taskOutput: string;
    smoke?: SmokeResult["observed"];
  };
  failure?: string;
}

export interface ProvisioningEvidence {
  runtime: ProvisioningStage[];
  taskCompleted: boolean;
  smoke: SmokeResult | undefined;
  artifacts: SmokeArtifacts;
  freshArtifact: boolean;
  hostUrlProbe: HostUrlProbe;
  observed: HealthReport["observed"];
  failure?: string | undefined;
}

export function assessProvisioning({
  runtime,
  taskCompleted,
  smoke,
  artifacts,
  freshArtifact,
  hostUrlProbe,
  observed,
  failure,
}: ProvisioningEvidence): HealthReport {
  const checks: HealthReport["checks"] = {
    // An empty stage list is no evidence, not a pass.
    runtimeInstalled: runtime.length > 0 && runtime.every((stage) => stage.ok),
    taskCompleted,
    smokePassed: smoke?.ok === true,
    // Whether speech was heard; `speechArtifact` is only whether the log a
    // maintainer reads survived the run. The two fail for different reasons.
    speechCaptured: smoke?.speechCaptured === true,
    speechArtifact: observed.speechArtifactBytes > 0,
    focusRetained: smoke?.focusLost === null,
    scheduledCmdNode:
      smoke?.schemaVersion === SMOKE_RESULT_SCHEMA_VERSION &&
      smoke.fixture === SMOKE_CONTROL_FIXTURE &&
      smoke.observed.executionPosture === SCHEDULED_TASK_POSTURE &&
      smoke.observed.platform === "win32" &&
      smoke.observed.executable.toLowerCase().includes("\\nvda-rig\\node-v"),
    freshArtifact,
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
