/**
 * Publish the four packages, in order, at one version. See ADR 0003.
 *
 *   node scripts/release.ts [--registry <url>]
 *
 * A published version can never be published again, so this refuses a dirty
 * tree, runs the tests, and checks that the versions agree before publishing
 * anything. A package whose version is already on the registry is skipped,
 * so a release that stopped partway is finished by running this again.
 *
 * The daemon is published last, from a staging copy carrying an
 * npm-shrinkwrap.json. A published package does not carry package-lock.json,
 * and the shrinkwrap is what makes every guest install the same tree: the one
 * resolved here, at release. It can only be resolved once the host the daemon
 * depends on is on the registry. npm leaves the shrinkwrap out of a package
 * with a `files` list unless the list names it, so the daemon's does.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** In dependency order: each is published after everything it pins. */
const PACKAGES = ["host", "voiceover", "playwright", "daemon"];

interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const at = process.argv.indexOf("--registry");
const registry = at === -1 ? [] : ["--registry", process.argv[at + 1] ?? ""];

/** Run a command, its output to this terminal: npm may need to ask for a one-time password. */
const run = (command: string, args: string[], cwd = "."): void => void execFileSync(command, args, { cwd, stdio: "inherit" });

/** Run a command for its output. */
const read = (command: string, args: string[], cwd = "."): string =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function published({ name, version }: Manifest): boolean {
  try {
    return read("npm", ["view", `${name}@${version}`, "version", ...registry]) === version;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (read("git", ["status", "--porcelain"])) fail("the working tree has changes; commit them, so what is published is a commit.");

const manifests = PACKAGES.map((name) => JSON.parse(readFileSync(join("packages", name, "package.json"), "utf8")) as Manifest);
const version = manifests[0]?.version ?? fail("no packages");
for (const manifest of manifests) {
  if (manifest.version !== version) fail(`${manifest.name} is ${manifest.version}; every package is released at ${version}.`);
  for (const [sibling, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (sibling.startsWith("@sr-receipts/") && range !== version) fail(`${manifest.name} pins ${sibling} ${range}, not ${version}.`);
  }
}

run("npm", ["test"]);

for (const [index, name] of PACKAGES.entries()) {
  const manifest = manifests[index] as Manifest;
  if (published(manifest)) {
    console.log(`${manifest.name}@${version} is already published; skipped.`);
    continue;
  }
  let directory = join("packages", name);
  if (name === "daemon") {
    // The package as it will be published, unpacked where no workspace can
    // reach it, so its dependencies resolve from the registry alone.
    const staging = mkdtempSync(join(tmpdir(), "sr-receipts-daemon-"));
    const tarball = read("npm", ["pack", "--silent", "--pack-destination", staging], directory);
    run("tar", ["-xzf", join(staging, tarball), "-C", staging]);
    directory = join(staging, "package");
    run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", ...registry], directory);
    run("npm", ["shrinkwrap"], directory);
  }
  run("npm", ["publish", ...registry], directory);
}
console.log(`Released ${version}.`);
