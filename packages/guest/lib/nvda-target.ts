/**
 * NVDA with headed Firefox on the Windows Guest Rig, as an Execution Target.
 *
 * Only an adapter: the mechanics stay where they were proven, in `session.ts`,
 * `guard.ts` and `steps.ts`. Must be reached from the interactive console
 * session, for the reasons `session.ts` gives.
 */
import { requireReader, type ExecutionTarget } from "./execution-target.ts";
import { excludeAddressBar } from "./firefox.ts";
import { openTarget, startSession, stopSession, watchFocus, type Session } from "./session.ts";
import { stamp } from "./stamp.ts";
import { runSteps, validateSteps } from "./steps.ts";

export const nvdaTarget: ExecutionTarget = {
  environment: stamp,

  async start() {
    let session: Session;
    try {
      session = await startSession();
    } catch (error) {
      // A half-started NVDA or a stray Firefox would trip the next run.
      await stopSession();
      throw error;
    }
    const { nvda, speech } = session;
    return {
      validate: (scenario) => {
        requireReader(scenario, "nvda");
        validateSteps(nvda, scenario.steps);
      },
      open: (target, scenario) =>
        openTarget(speech, target, { modeProbes: scenario.modeProbes, window: scenario.window }),
      // Re-check every few steps that the keystrokes are still reaching the
      // page, so a stolen foreground stops the sequence instead of typing the
      // rest of it into somebody else's window.
      perform: async (scenario, onStep) => {
        const watch = watchFocus(
          speech,
          scenario.focusCheckEvery === undefined ? {} : { every: scenario.focusCheckEvery },
        );
        const result = await runSteps(nvda, speech, scenario.steps, { onStep, watch });
        return { ...result, steps: excludeAddressBar(result.steps) };
      },
      stop: stopSession,
    };
  },
};
