/**
 * The Execution Target seam: the platform and screen-reader runtime that
 * executes a scenario and produces its observed speech.
 *
 * Everything on the far side of this interface is one reader's mechanics:
 * launching it, getting its browser to the page, proving keystrokes reach the
 * content, and reading back what it said. Everything on the near side, in
 * `run.ts`, is shared: loading scenarios, the verdict, snapshots, transcripts,
 * `results.json` and the event stream. That side must never need to know which
 * target it is driving.
 *
 * Deliberately no wider than the evidence. Both proven targets share this
 * lifecycle: start the reader, record the environment that produced the
 * speech, capture what it said, and stop without masking the failure that came
 * first. NVDA implements it (`nvda-target.ts`). The VoiceOver target does not:
 * it has proven its own smoke run, not transcript scenarios, whose step
 * vocabulary is NVDA's.
 */
import type { CompiledScenario, OpenResult, RunStepsResult, StepResult } from "./types.ts";

export interface ExecutionTarget {
  /**
   * What will produce the speech: OS, browser and reader builds. It heads every
   * transcript, rides along in snapshots, and answers `GET /health`.
   */
  environment(): string[];
  /**
   * Start the reader for a whole run. A target whose start fails cleans up
   * after itself before throwing, because there is no session to stop.
   */
  start(): Promise<ReaderSession>;
}

/** One reader, started, for every request in a run. */
export interface ReaderSession {
  /**
   * Throw if the scenario asks for something this reader cannot do. Called
   * for every scenario before the first target opens, so a typo costs a second
   * rather than a run that ends in silences that look exactly like real ones.
   */
  validate(scenario: CompiledScenario): void;
  /**
   * Get the reader to the top of the target, ready to navigate. When `ok` is
   * false, `lines` is the entire diagnosis and nothing is performed.
   */
  open(target: string, scenario: CompiledScenario): Promise<OpenResult>;
  /**
   * Run the scenario's steps against the opened target, reporting each as it
   * is heard. Stops early, naming the thief, if the page loses the foreground.
   */
  perform(
    scenario: CompiledScenario,
    onStep: (step: StepResult, index: number) => void,
  ): Promise<RunStepsResult>;
  /** Never throws: a failed teardown must not mask the error that caused it. */
  stop(): Promise<void>;
}
