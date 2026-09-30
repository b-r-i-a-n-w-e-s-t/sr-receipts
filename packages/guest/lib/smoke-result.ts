/** The machine-readable contract between the smoke entry point and provisioner. */
import { join } from "node:path";

export const SMOKE_RESULT_SCHEMA_VERSION = 2;
export const SMOKE_CONTROL_FIXTURE = "control.html";
export const SCHEDULED_TASK_POSTURE = "scheduled-task-cmd";

/** Where one proof run's result and speech log live. */
export interface SmokeArtifacts {
  result: string;
  speech: string;
}

/** What the provisioner asks the scheduled task to prove, and where. */
export interface SmokeRequest extends SmokeArtifacts {
  runId: string;
}

/**
 * Named here rather than in either script, so the provisioner, the scheduled
 * task and the smoke entry point cannot disagree about which files a run's
 * evidence is in.
 */
export function smokeArtifacts(runId: string): SmokeArtifacts {
  return {
    result: join("artifacts", `smoke-result-${runId}.json`),
    speech: join("artifacts", `smoke-log-${runId}.txt`),
  };
}

export interface SmokeResult {
  schemaVersion: typeof SMOKE_RESULT_SCHEMA_VERSION;
  /** The provisioner-generated identifier that owns this result, if any. */
  runId: string | null;
  fixture: string;
  ok: boolean;
  expectedSteps: number;
  completedSteps: number;
  speechCaptured: boolean;
  error: string | null;
  observed: {
    node: string;
    executable: string;
    platform: string;
    architecture: string;
    executionPosture: string | null;
  };
}
