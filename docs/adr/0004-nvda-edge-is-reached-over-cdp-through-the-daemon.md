---
status: accepted
date: 2026-11-25
amends: 0002
---

# NVDA's Edge is reached over CDP, through the daemon

ADR 0002 put the guest's Edge behind a Playwright browser server and had the
consumer reach it with Playwright's own `connectOptions`. A Playwright client
connects only to a browser server of its own major.minor, so decision 8
coupled every consumer's `@playwright/test` to the `playwright-core` the
Runtime Manifest pins on the guest. That stopped the first real consumer:
carbon-svelte's lockfile is on Playwright 1.65 and the guest on 1.63, and
moving either side moves every other consumer of that guest with it.

A prototype on 2026-11-25 (branch `prototype/cdp-connect`,
`prototypes/cdp-connect/PROTOTYPE-README.md`) connected a Playwright 1.65
consumer to the 0.5.0 guest's Edge with `chromium.connectOverCDP`, through an
SSH forward standing in for authentication. Its Receipt File matched a 1.63
browser-server run byte for byte, four runs of four.

## Considered options

- **Keep the browser server and pin consumers.** Rejected: it makes the
  guest's Playwright everyone's, and a consumer's routine Playwright upgrade a
  guest upgrade.
- **One guest per Playwright minor, or several browser servers.** Rejected:
  a daemon carrying several `playwright-core` builds is the coupling
  multiplied, not removed.
- **CDP to an Edge the daemon owns, behind the daemon's token.** Chosen. CDP
  is Chromium's own protocol, so the consumer's Playwright talks to Edge
  directly and no Playwright on the guest has to match it.

## Decisions

1. **The daemon launches and owns Edge.** It starts the installed
   `msedge.exe` itself, headed, with remote debugging on loopback only, a
   profile of its own that persists across restarts, first-run prompts
   suppressed, and no startup window. It finds the debugging endpoint in the
   profile's `DevToolsActivePort`, so no fixed port can collide. Edge starts
   with the daemon, and an Edge that has exited is started again by the next
   connection rather than by a watchdog.
2. **The Browser Endpoint is on the daemon's port, behind its token.** A
   WebSocket upgrade on `/browser` presents `Authorization: Bearer <token>`,
   checked as every route checks it, and is then piped to Edge's loopback
   endpoint. CDP has no authentication of its own, and full control of the
   browser includes the guest's file system, so nothing reaches Edge
   without the token. The token is no longer in any URL, so Playwright's
   connect errors no longer print it. The guest has one port again: 8766,
   `RIG_BROWSER_PORT` and `RIG_BROWSER` retire, and the Provisioner removes
   its 8766 firewall rule.
3. **The Playwright package owns an NVDA project's `browser`.** Its fixture
   connects with `connectOverCDP` to the `/browser` of the `url` already in
   `readerOptions`, with the `token` already there. The consumer's config
   loses `connectOptions`. A VoiceOver project's `browser` is launched as
   Playwright's own would be.
4. **Only the protocol is checked; the browser's coupling is stamped.** The
   preflight checks the wire protocol, and that `/health` reports Edge
   running. No Playwright version is compared. What remains coupled is the
   consumer's Playwright to Edge's CDP, and Edge updates itself on the guest
   with no published table to check against, so the Environment Stamp names
   both: Edge's build, and the consumer's Playwright as what drove it over
   CDP. The peer range of `@playwright/test` is `^1.61.0`, the oldest
   tested against the guest.
5. **Wire protocol 4.** `/health` loses `playwright` and the browser
   server's port and path, and its `browser` says whether Edge is running
   and, if not, why. There is no compatibility with protocol 3: the
   protocol check names the mismatch and its fix.
6. **The daemon keeps `playwright-core` for the Smoke only.** The Smoke
   connects through `/browser` on loopback, so it proves the path a test
   takes, proxy included. The Runtime Manifest still pins it as reviewed
   code; a consumer no longer has to match it.

This replaces ADR 0002 decision 7 (the token is the browser server's path)
and decision 8 (versions are coupled across the wire), and the half of
decision 1 that names the browser server and `connectOptions`.

## Consequences

- **A consumer's Playwright upgrade no longer touches the guest**, within the
  tested range. Its cost moved: Playwright documents `connectOverCDP` as
  lower fidelity than its own protocol, and an old Playwright against a newly
  updated Edge is where it would break. That break shows as Playwright's own
  error, and the stamp names both versions.
- **The daemon owns a browser process**, including its profile and its
  restart, which Playwright's `launchServer` did before.
- **The browser connection shares the daemon's event loop.** A reader call
  that blocks it, such as the NVDA quit hang, stalls the browser too. That was
  already true of the in-process browser server.
- **Every consumer's config changes once**: `connectOptions` and
  `RIG_BROWSER` go.
