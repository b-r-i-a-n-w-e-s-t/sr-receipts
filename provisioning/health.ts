import {
  SMOKE_CONTROL_FIXTURE,
  SMOKE_RESULT_SCHEMA_VERSION,
  SCHEDULED_TASK_POSTURE,
  type SmokeResult,
} from "../lib/smoke-result.ts";

export interface HealthReport {
  schemaVersion: 2;
  ok: boolean;
  fixture: typeof SMOKE_CONTROL_FIXTURE;
  execution: "unelevated interactive scheduled task: real NVDA with headed Firefox";
  checks: {
    taskCompleted: boolean;
    smokePassed: boolean;
    speechCaptured: boolean;
    focusRetained: boolean;
    scheduledCmdNode: boolean;
    freshArtifact: boolean;
  };
  artifact: string;
  observed: {
    reporterNode: string;
    reporterPlatform: string;
    reporterArchitecture: string;
    taskOutput: string;
    smoke?: SmokeResult["observed"];
  };
  failure?: string;
}

export function assessSmoke(
  taskCompleted: boolean,
  smoke: SmokeResult | undefined,
  artifact: string,
  freshArtifact: boolean,
  observed: HealthReport["observed"],
  failure?: string,
): HealthReport {
  const smokePassed = smoke?.ok === true;
  const speechCaptured = smoke?.speechCaptured === true;
  const focusRetained = smoke?.focusLost === null;
  const scheduledCmdNode =
    smoke?.schemaVersion === SMOKE_RESULT_SCHEMA_VERSION &&
    smoke.fixture === SMOKE_CONTROL_FIXTURE &&
    smoke.observed.executionPosture === SCHEDULED_TASK_POSTURE &&
    smoke.observed.platform === "win32" &&
    smoke.observed.executable.toLowerCase().includes("\\nvda-rig\\node-v");
  return {
    schemaVersion: 2,
    ok: taskCompleted && smokePassed && speechCaptured && focusRetained && scheduledCmdNode && freshArtifact,
    fixture: SMOKE_CONTROL_FIXTURE,
    execution: "unelevated interactive scheduled task: real NVDA with headed Firefox",
    checks: { taskCompleted, smokePassed, speechCaptured, focusRetained, scheduledCmdNode, freshArtifact },
    artifact,
    observed,
    ...(failure ? { failure } : {}),
  };
}
