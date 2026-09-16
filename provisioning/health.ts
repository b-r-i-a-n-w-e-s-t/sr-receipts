/**
 * Turn the smoke artifact into a machine-readable provisioning verdict.
 *
 * Keeping this decision pure means the PowerShell provisioner can always
 * persist useful evidence, including when the desktop-dependent smoke fails.
 */
export interface HealthReport {
  schemaVersion: 1;
  ok: boolean;
  fixture: "control.html";
  execution: "unelevated interactive scheduled task: real NVDA with headed Firefox";
  checks: {
    smokeExited: boolean;
    speechCaptured: boolean;
    freshArtifact: boolean;
  };
  artifact: string;
  observed: {
    node: string;
    platform: string;
    architecture: string;
    taskOutput: string;
  };
  failure?: string;
}

const SPEECH_HEADING = "### ";

/** A smoke log has speech only when a recorded step has non-silent content. */
export function hasCapturedSpeech(smokeLog: string): boolean {
  const sections = smokeLog.split(SPEECH_HEADING).slice(1);
  return sections.some((section) => {
    const speech = section.split("\n").slice(1).join("\n").trim();
    return speech.length > 0 && speech !== "(silence)";
  });
}

export function assessSmoke(
  smokeExited: boolean,
  smokeLog: string | undefined,
  artifact: string,
  freshArtifact: boolean,
  observed: HealthReport["observed"],
  failure?: string,
): HealthReport {
  const speechCaptured = smokeLog === undefined ? false : hasCapturedSpeech(smokeLog);
  return {
    schemaVersion: 1,
    ok: smokeExited && speechCaptured && freshArtifact,
    fixture: "control.html",
    execution: "unelevated interactive scheduled task: real NVDA with headed Firefox",
    checks: { smokeExited, speechCaptured, freshArtifact },
    artifact,
    observed,
    ...(failure ? { failure } : {}),
  };
}
