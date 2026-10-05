---
status: accepted
date: 2026-09-25
supersedes: 0001
---

# Playwright drives the browser, and a reader is a session beside it

A developer working on an app such as carbon-svelte hits an accessibility
issue, wants to reproduce it, find the cause and try fixes, and wants the
evidence to be something a ticket can cite rather than a screen recording of
someone driving a screen reader. They should write ordinary Playwright tests in
the app's repository and run them on VoiceOver or NVDA with one command, on a
Mac, with a Windows virtual machine of their own beside it. They should own as
little code as possible, and other developers should be able to do the same on
their apps.

ADR 0001 rejected Playwright's `page` because it changes the browser under
test: Playwright cannot drive Safari or release Firefox. On 2026-09-25 that
premise was dropped. The browser is not the concern; `page`, standard tooling,
and a small surface are. This supersedes ADR 0001. The pivot's proof of concept
and its numbers are in `carbon-svelte-docs/.scratch/guidepup-playwright-spike/`,
in the consuming repository's scratch space.

## Considered options

- **Guidepup's own shape: Playwright runs where the reader is.** Its
  `nvdaTest` and `voiceOverTest` fixtures give a real `page`, and its
  `screenReaderTest` picks the reader by platform. Rejected for this project:
  the NVDA half runs inside the virtual machine, so every developer's specs
  have to be synced into it, run there, and their report fetched and merged,
  and that wrapper is exactly the orchestration the developer did not want to
  own. The stock fixtures also have none of the rig's guards: every NVDA run
  of the proof of concept was in focus mode after activation, and only the
  behavioural probe caught it. It remains the right shape for a hosted Windows
  CI runner, and the fixture's method names keep that door open.
- **The Mac is the only runner; the guest serves the reader and a browser.**
  Chosen, and proved: VoiceOver in process on the Mac, NVDA through the
  guest daemon's routes, `page` on both, one spec, one command, 4 of 4 and
  then 10 of 10 on NVDA.
- **Keep the scenario language and add `page` beside it.** Rejected: a test
  is code against `page` and a reader, and Playwright's `expect` judges it.
  Two ways of writing a question would be two things to teach.

## Decisions

1. **Playwright drives the browser on both readers.** A VoiceOver project's
   browser is whatever Playwright launched on the Mac: its WebKit, or a
   branded Chrome. An NVDA project's browser is the guest's Edge, launched by
   the daemon as a Playwright browser server and reached with Playwright's own
   `connectOptions`. Safari and release Firefox are no longer under test.
2. **A reader is a session.** `ReaderSession`, in `@sr-receipts/host`, is
   the one interface a test sees: `start`, `stop`, `enter(page)`, `perform`,
   `press`, `next`, `previous`, `capture(action)`, the speech log, and the
   environment. Its method names are Guidepup's, so a spec written against it
   could run under Guidepup's own fixtures with a one-line swap if the runner
   ever moves into the guest. VoiceOver implements it in process in
   `@sr-receipts/guest`; NVDA implements it over the wire in the host package.
   _Amended 2026-10-05:_ VoiceOver's implementation is now its own package,
   `@sr-receipts/voiceover` (ADR 0003).
3. **The guards run on the guest.** `POST /reader/enter` takes the page's
   title and proves, in order, that the browser is in front, that focus is in
   the document, and that browse mode is on, by behaviour. Activation and
   window listing only work from inside the interactive session, which is
   why the guards run there. A test whose entry fails is never certified.
   _Amended 2026-09-30:_ activation and window listing were also standalone
   routes, `GET /desktop/windows` and `POST /desktop/activate`; nothing on
   the Mac ever called them, so they are gone. `/reader/enter` is where they
   run.
4. **`capture(action)` is how a page action's speech is heard.** Guidepup
   records speech only inside one of its own actions. `capture` runs a
   foreign action inside that window. Over the wire it is two routes, `begin`
   answering once the listener is attached, `end` returning what was said.
5. **Calls on one reader are serialized, and `start` restarts.** One desktop
   cannot interleave two callers' keystrokes. A test that never stopped its
   reader would otherwise hold it for every test after it.
6. **One reader start per test.** Stock parity, measured: 3.5 s on NVDA.
7. **The token is the browser server's path.** Playwright's own protection
   for a browser server is a secret path; using the daemon's bearer token
   keeps one secret, and the consumer's `wsEndpoint` is derivable from what
   the daemon prints.
8. **Versions are coupled across the wire.** A Playwright client connects
   only to a browser server of the same major.minor. The Runtime Manifest
   pins the guest's `playwright-core`, and a consumer's `@playwright/test`
   must match it.
9. **What retires.** The scenario language and its compiler, the step
   runner, expectations and checks, the runner's snapshots, the run, queue,
   probe and smoke-by-scenario entry points, the daemon's run routes and
   event stream, the Firefox profile and driver, the Safari driver, and the
   Execution Target seam. Playwright's `expect`, attachments, trace and
   `toMatchSnapshot` take their jobs, and a spec takes the scenario's.
10. **The durable record is per test.** The fixture attaches a
    `reader-transcript` (every call and its answer, silence named) and the
    `environment` stamp to every test, beside Playwright's own report and
    trace. That is what a ticket cites.
11. **Three packages stay, with new jobs.** The host owns the wire, the
    reader interface and the NVDA session, and knows no reader's commands.
    The guest owns the daemon, the guards, the VoiceOver session and the
    Provisioner. The Playwright package owns the fixture. An NVDA-only
    consumer never installs Guidepup.
    _Amended 2026-10-05:_ replaced by ADR 0003. There are four packages
    now: the guest is `@sr-receipts/daemon`, and the VoiceOver session moved
    out of it into `@sr-receipts/voiceover`.
12. **Each developer runs their own guest, as an appliance.** The daemon is
    registered at logon by the Provisioner, so a booted, signed-in VM answers
    `npm run sr-testing` with nothing else started by hand.
    _Amended 2026-09-30:_ the Smoke proves that daemon, as its client through
    the same `ReaderSession` a test uses, rather than a second NVDA lifecycle
    of its own under a scheduled task of its own. The `nvda-smoke` task and
    the smoke's request and artifact contract are gone.

## Consequences

Costs accepted knowingly, with what was measured on 2026-09-25:

- **Edge, not Firefox, on the guest.** Playwright ships no Windows ARM64
  browsers and calls the platform unsupported; the installed Edge is the one
  native browser it can drive. NVDA plus Firefox evidence is gone.
- **WebKit or Chrome, not Safari, on the Mac.**
- **An NVDA entry costs about 28 s**, 12 s of it the focus-mode repair the
  stock fixture does not do. A VoiceOver entry costs 15 to 25 s. A captured
  page action costs 1.5 s on NVDA and 5 s on VoiceOver. A speaking NVDA
  command costs 1.3 s round trip, a silent one 2.3 s.
- **Two ports on the guest**, and a firewall rule that needs elevation once.
- **A VoiceOver test still takes over the Mac** and must be launched from
  the application holding the macOS privacy grants.
- **Every developer provisions a VM.** The Provisioner is the product.

## Deferred, with what would revive each

- **A committed markdown receipt per failing test**, written by the fixture:
  when a ticket needs a file in the repo rather than a report attachment.
- **A mid-test focus watch** (the rig's `reportTitle` between steps): when a
  long reader-driven sequence is stolen from mid-test and `expect` does not
  catch it soon enough.
- **A reader session per worker** rather than per test: when start time
  dominates a suite.
- **Guidepup's Virtual Screen Reader as a third project**: unchanged from
  ADR 0001, and its output is never a Receipt.
