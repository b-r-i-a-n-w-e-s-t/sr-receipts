/**
 * The rig core. Everything `runner.cjs` and `probe.cjs` are built from, and the
 * surface the host-side client will drive once Phase 4 puts a daemon in front of
 * it.
 */
module.exports = {
  ...require("./system.cjs"),
  ...require("./firefox.cjs"),
  ...require("./speech.cjs"),
  ...require("./target.cjs"),
  ...require("./guard.cjs"),
  ...require("./stamp.cjs"),
  ...require("./steps.cjs"),
  ...require("./session.cjs"),
};
