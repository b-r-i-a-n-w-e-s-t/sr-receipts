---
status: accepted
date: 2026-09-21
---

# Playwright is the runner, not the browser driver

A consuming repo should be able to test NVDA and VoiceOver from its own
Playwright tests. Playwright cannot drive Safari.app or release Firefox (it
ships patched builds, and `@guidepup/playwright` activates the apps named
"Playwright" and "Nightly"), and those two browsers are what this project
records evidence from. So sr-receipts uses Playwright Test as runner, reporter
and configuration surface, and ships a `receipts` fixture with no `page`. The
reader, its real browser, the guards and the verdict stay where they are,
behind the Execution Target seam. Sources:
[`research/guidepup-reading-list-2026-09.md`](../../research/guidepup-reading-list-2026-09.md)
and [`research/guidepup-playwright-dogwalk.md`](../../research/guidepup-playwright-dogwalk.md).

## Considered options

- **Re-export `@guidepup/playwright`'s `nvdaTest` and `voiceOverTest`.**
  Rejected: it changes the browser under test, which invalidates every baseline
  and the premise that a Receipt is what a real user's reader said. Its
  VoiceOver `navigateToWebContent` also loops without a limit on a phrase that
  macOS 26 was recorded not speaking, restarts the reader for every test, and
  swallows a failed stop.
- **Guest-native Playwright with `page`** (the dogwalk research's option A, and
  the glossary's former "Registered Playwright Suite"). Deferred, not rejected.
  See "Deferred".
- **An imperative per-step API** (`await reader.perform(...)` from the test).
  Rejected: for NVDA it needs a per-step session protocol, and it bypasses the
  focus watch, the arrival proof and the sentinel unless each is rebuilt per
  call.

## Decisions

1. **Unit of a test.** One test runs one whole scenario against one target,
   `receipts.run(target, scenario)`, judged by the existing verdict. A test may
   pass several requests to batch them into one run.
2. **Two transports behind one small interface** that takes requests and
   returns a report. NVDA goes through the existing daemon and
   `createClient`. VoiceOver runs in-process through
   `executeRun(voiceOverTarget, ...)`. There is no daemon on macOS.
3. **One reader start per test** is accepted for now and measured in the first
   slice. No session API until the numbers hurt.
4. **Scenarios cross the wire inline.** A scenario object is accepted wherever
   a scenario reference is, and compiled by the same `compileScenario`. Names
   and paths keep working for the runner. The structural `Scenario` type moves
   to the host's protocol and the guest re-exports it. Command names stay
   validated at run time, by the reader session, before any target opens.
5. **Baselines for a consumer are Playwright's.** The first slice has none,
   only `expect` and `checks`. After it, the fixture hands the run's
   `label -> heard` map to `toMatchSnapshot`, so the files live in the
   consuming repo and the project name keeps the readers apart. The environment
   stamp is a report attachment. The runner keeps its own snapshots.
6. **A third workspace package, `@sr-receipts/playwright`.** `@playwright/test`
   is a peer dependency, the host a dependency, and the guest an optional peer
   imported only by a VoiceOver project, so an NVDA-only consumer never
   installs Guidepup.
7. **Verdict mapping.** `run()` fails the test on findings by default and lists
   them, throws when the run broke, and returns the Receipt. `{ assert: false }`
   is for an investigation that wants the transcript whatever the verdict.
8. **One Playwright project per reader**, configured as
   `use: { receipts: { reader, url, token, baseURL } }`, with a
   `*.nvda.spec.ts` and `*.voiceover.spec.ts` convention. A scenario written for
   the other reader is a broken run, never a skip. The shipped configuration
   sets `workers: 1` and `retries: 0`, because a retry that turns a finding
   green destroys the evidence. A busy daemon (`409`) fails fast and names the
   run in flight.
9. **Timeouts are derived from the scenario**: an open budget plus a per-reader
   budget for each step, overridable. Starting guesses are 90 seconds to open,
   10 seconds a step on NVDA and 25 on VoiceOver. The first slice corrects them.
10. **The report** gets the transcript, the environment stamp and the
    `RunResult` JSON as attachments. Live `test.step` entries wait until the
    report is shown to need them.
11. **A consumer's target is a path or a URL**, joined to the project's
    `baseURL`. The NVDA project's `baseURL` is the address the guest reaches the
    host by. Fixture-file targets stay a runner concept.
12. **Distribution is npm, eventually.** The first consumer is
    `txstate-etc/carbon-svelte`, linked by `file:`, uncommitted, with its own
    `playwright.receipts.config.ts`. Whether the packages need a build step is
    decided when publishing is real.
13. **A simulated reader never produces a Receipt.** Guidepup's Virtual Screen
    Reader is a candidate for a third project with a real `page`, undecided and
    gated on a prototype after both real-reader projects work. Whatever is
    decided, its output is never compared with a real reader's baseline, keeps
    its own snapshots, and is headed "simulated, not a screen reader".
14. **Upstream Guidepup issues** (the unbounded Item Chooser loop, the
    `readTableColumnHeader` misfire, the unconfigurable polling constants) are
    each filed only after a minimal reproduction and the owner's approval at
    that time.

## Consequences

Costs accepted knowingly:

- **Two transports.** The fixture has an HTTP implementation and an in-process
  one.
- **Two snapshot mechanisms.** The runner's own, which records the environment
  inside the file that explains a diff, and Playwright's, which does not.
- **The VoiceOver project is tied to a terminal.** `playwright test` must be
  launched from the application that holds the macOS privacy grants, and the
  consuming repo installs the guest package, and Guidepup with it, on the Mac.
- **Command names are not type-checked for a consumer.** A typo costs one
  reader start.

## Deferred, with what would revive each

- **A guest-native `page` tier**: when a scenario needs page state that neither
  a URL nor the reader's own keys can reach. NVDA with branded Chrome only,
  since that is the one pairing where Playwright drives a browser real users
  run.
- **A daemon on macOS**: when interrupted Playwright runs leave VoiceOver
  talking in practice, or when VoiceOver moves to a dedicated macOS user or a
  virtual machine.
- **A reader session API**: when one reader start per test makes a consumer's
  suite too slow to run.
