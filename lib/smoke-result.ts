/** The machine-readable contract between the smoke entry point and provisioner. */
export const SMOKE_RESULT_SCHEMA_VERSION = 1;
export const SMOKE_CONTROL_FIXTURE = "control.html";
export const SCHEDULED_TASK_POSTURE = "scheduled-task-cmd";

export interface SmokeResult {
  schemaVersion: typeof SMOKE_RESULT_SCHEMA_VERSION;
  /** The provisioner-generated identifier that owns this result, if any. */
  runId: string | null;
  fixture: string;
  ok: boolean;
  expectedSteps: number;
  completedSteps: number;
  speechCaptured: boolean;
  focusLost: string | null;
  error: string | null;
  observed: {
    node: string;
    executable: string;
    platform: string;
    architecture: string;
    executionPosture: string | null;
  };
}
