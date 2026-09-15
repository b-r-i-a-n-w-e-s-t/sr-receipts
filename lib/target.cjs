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

/**
 * Anything to something NTFS will accept as a file name. Used for both halves of
 * a transcript's name: a target may be a URL, and a scenario's name defaults to
 * whatever reference loaded it, which may be a path.
 */
const slugify = (text) =>
  text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "unnamed";

function resolveTarget(target, { settle } = {}) {
  if (/^https?:/i.test(target)) {
    return {
      url: target,
      provenance: `url, no local bytes to hash: ${target}`,
      settle: settle ?? SETTLE.url,
      slug: slugify(target),
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
 * The scenario a queue line gets when it does not name one.
 *
 * Set to the column-list investigation because that is what this rig's existing
 * `queue.txt` means, and changing it silently would change the answer to a
 * question that is still open. When the rig stops being column-list-shaped this
 * becomes `survey`.
 */
const DEFAULT_SCENARIO = "column-list-table";

/**
 * Parse a queue file into run requests.
 *
 * One request per line, blank lines skipped, `#` comments stripped so an example
 * queue can explain itself without its explanation being opened as a fixture
 * named "# One target per line".
 *
 * A line is `<target>` or `<target> :: <scenario>`:
 *
 *   control.html
 *   control.html :: survey
 *   http://192.168.64.1:5173/docs/column-list :: ./a11y/scenarios/table.mjs
 *
 * The `{ target, scenario }` shape returned here is deliberately the same shape
 * the Phase 4 daemon will accept over HTTP, so the queue file and the host-side
 * client stay one code path.
 */
function parseQueue(text, { defaultScenario = DEFAULT_SCENARIO } = {}) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#.*$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [target, scenario] = line.split("::").map((part) => part.trim());
      if (!target) {
        throw new Error(`queue line names no target: ${JSON.stringify(line)}`);
      }
      return { target, scenario: scenario || defaultScenario };
    });
}

module.exports = {
  FIXTURES,
  SETTLE,
  DEFAULT_SCENARIO,
  slugify,
  resolveTarget,
  parseQueue,
};
