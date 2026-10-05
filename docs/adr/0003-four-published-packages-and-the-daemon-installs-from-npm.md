---
status: accepted
date: 2026-10-01
amends: 0002 (decision 11)
---

# Four published packages, and the daemon installs from npm

Until now the packages reached their two destinations by checkout. A consuming
repository symlinked `@sr-receipts/playwright` into its `node_modules`, and the
Windows Guest Rig ran a git clone and `npm ci`. Neither survives a second
developer. The packages export raw TypeScript, and Node refuses to strip types
under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, verified
2026-09-30), so nothing but a symlink into a checkout could load them. On the
guest, the clone drifted: on 2026-09-30 it turned out never to have been
re-provisioned since the pivot, with a stale `node_modules`, retired tasks and
a dirty tree.

The guest package was also two things. It held the Windows daemon and its
Provisioner, and it held the VoiceOver session a Mac imports, so a VoiceOver
consumer installed `playwright-core`, `@guidepup/setup` and the PowerShell
scripts to get one function.

## Considered options

- **Keep the guest as a git clone, publish only what consumers import.**
  Rejected: the clone is what drifted, and it keeps a second way of delivering
  code that only the guest uses.
- **Publish the guest whole, VoiceOver inside.** Rejected: every VoiceOver
  consumer pulls the Windows payload.
- **Fold the host and VoiceOver into the Playwright package.** Rejected: an
  NVDA-only consumer would install Guidepup. Making Guidepup the optional peer
  instead avoids that, but hands the Guidepup pin to each consumer, and the
  pin is a reviewed version this project owns.
- **Four packages, published publicly.** Chosen. A scratch build on
  2026-10-01 proved the shape: `tsc -b` built all four, and the packed
  tarballs installed outside any workspace loaded under Node 24.14.1 and
  Playwright 1.63.0, with types resolving in the consumer.
- **Restricted packages.** Rejected: a token on every consumer, every CI job
  and every guest.

## Decisions

1. **Four packages, public, MIT, copyright Brian West.**
   `@sr-receipts/host` keeps the wire, the reader interface and the NVDA
   session. `@sr-receipts/voiceover` is new: the VoiceOver session and its
   doctor, carved from the guest, depending on the host and Guidepup.
   `@sr-receipts/playwright` keeps the fixture and the matchers.
   `@sr-receipts/daemon` is the guest renamed: the daemon, the guards, the
   Smoke, the Provisioner and the control Fixture. This replaces decision 11
   of ADR 0002.
2. **Packages ship built JavaScript and declarations; the source stays
   erasable TypeScript.** `tsc -b` with `rewriteRelativeImportExtensions`
   emits `dist/` per package, and each package's `exports` points there. In
   this repository tests still run the `.ts` directly, but a package reaches
   its sibling through `dist/`, so `npm test` builds first.
3. **One version, released together.** Siblings pin each other exactly, so
   the four are published in order (host, voiceover, playwright, daemon) at
   the same version.
4. **VoiceOver is an optional peer of the Playwright package.** A VoiceOver
   project installs `@sr-receipts/voiceover` beside it; an NVDA-only consumer
   never installs Guidepup. The VoiceOver package owns the Guidepup pin.
5. **The daemon reaches the guest from npm, behind a bootstrap script.** For
   an exact version, the bootstrap stops a running daemon, unpacks the
   published `@sr-receipts/daemon` into the rig's state directory, installs
   the Runtime Manifest's pinned Node, installs the dependencies with
   `npm ci` inside the package, and runs the Provisioner. The git clone on
   the guest retires. An upgrade is the bootstrap again with the new version.
   Trying a change before it is published is `npm pack` on the Mac and the
   bootstrap given the tarball. Such a tarball has no shrinkwrap, since only
   the release resolves one, so its dependencies are resolved as it installs
   and the bootstrap says it is not the reviewed tree. A published version
   without one is refused.
6. **The daemon package publishes an `npm-shrinkwrap.json`, and the guest
   installs from it with `npm ci`.** A published package does not carry
   `package-lock.json`, so without it only Guidepup and `playwright-core`
   would be exact and everything beneath them would float. The shrinkwrap is
   resolved by the release, from the registry, so every guest installs the
   tree that existed at release; it is not the repository's lockfile, and can
   be newer. `npm ci` inside the unpacked package is what makes it the
   lockfile. `npm install @sr-receipts/daemon` was rejected: on 2026-10-05,
   against a local registry, it ignored a dependency's shrinkwrap and
   installed a newer match, because npm follows a dependency's shrinkwrap
   only when the registry's metadata says the package has one.
7. **The rig's state lives outside the package.** The daemon's log and pid
   file, the Smoke's transcript and the Provisioner's reports go under
   `%LOCALAPPDATA%\nvda-rig`, where the Provisioner already keeps Node, and
   the daemon runs from there. A reinstall replaces the package directory, and
   Windows will not replace a directory a running process is standing in.
8. **The host refuses a daemon that speaks a different wire.** The wire has
   a protocol version, one integer in the host, bumped by hand only when a
   route or a payload changes. The daemon reports the one it was built
   against in `/health`, which `start` already asks for, and the session
   fails there with a message naming both, rather than later on a route that
   changed. Comparing package versions was rejected: with lockstep releases,
   every release would refuse every guest, including releases that never
   touched the wire.

## Consequences

- **The source is public** once published, whatever the repository's
  visibility.
- **A release is four publishes and a generated shrinkwrap**, done by
  `scripts/release.ts`. On 2026-10-05 it was run end to end against a local
  registry: four packages published in order, the daemon's shrinkwrap
  inside its tarball, and `npm ci` in the unpacked daemon installing exactly
  the shrinkwrap's 51 packages. npm leaves the shrinkwrap out of a package
  with a `files` list unless the list names it, so the daemon's does.
- **There is a build.** The guest still needs no toolchain, because it
  receives built JavaScript. That also frees the guest's Node pin from type
  stripping, so it can be raised past the `undici` engine warning.
- **The guest's code can no longer be edited in place** and restarted.
- **The Windows half is unproven until a fresh guest is provisioned this
  way.** The packages, the release and the shrinkwrapped install were run on
  the Mac; the bootstrap, the upgrade and the moved state were reasoned from
  the scripts.
- **"Guest" stops naming a package.** `CONTEXT.md` changes with the rename.
