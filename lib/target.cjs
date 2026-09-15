/**
 * Turning a queue entry into something the rig can open, with provenance.
 *
 * An entry is either a fixture file name, resolved under `fixtures\`, or an
 * `http`/`https` URL passed through unchanged. A URL has no local bytes to hash,
 * and it comes from a Vite dev server across the host boundary, so it needs
 * longer to compile, hydrate and settle than a local file does.
 *
 * Both callers used to carry their own copy of this, and the two had already
 * drifted: the probe settled a fixture for 10s and the runner for 14s, so a
 * sequence worked out in the probe could behave differently in the run that was
 * supposed to confirm it. One definition, one set of numbers.
 */
const { join } = require("node:path");
const { gitBlobHash } = require("./system.cjs");

const FIXTURES = join(__dirname, "..", "fixtures");

/** Measured, not guessed. Override per call only with a reason. */
const SETTLE = { fixture: 14000, url: 30000 };

function resolveTarget(target, { settle } = {}) {
  if (/^https?:/i.test(target)) {
    return {
      url: target,
      provenance: `url, no local bytes to hash: ${target}`,
      settle: settle ?? SETTLE.url,
      slug: target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""),
    };
  }
  const path = join(FIXTURES, target);
  return {
    url: "file:///" + path.replace(/\\/g, "/"),
    provenance: `fixture git blob: ${gitBlobHash(path)}`,
    settle: settle ?? SETTLE.fixture,
    slug: target,
  };
}

/**
 * Parse a queue file: one target per line, blank lines skipped, `#` comments
 * stripped so an example queue can explain itself without its explanation being
 * opened as a fixture named "# One target per line".
 */
function parseQueue(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#.*$/, "").trim())
    .filter(Boolean);
}

module.exports = { FIXTURES, SETTLE, resolveTarget, parseQueue };
