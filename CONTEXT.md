# sr-receipts

The product that lets a developer drive real screen readers from the
Playwright tests of the app they are working on, on the desktops those readers
live on, and keeps what each one said as evidence. Formerly named Dogwalk.

## Language

### Where things run

**Host**:
The machine a developer works on, where their Playwright tests run, and the
`@sr-receipts/host` package that reaches a Guest's Daemon from it. It owns the
Reader Session and the wire. The wire is an NVDA wire: NVDA is the only
reader that crosses it, and its routes, health and entry options (the mode
probes) are NVDA's. The host still knows no reader's commands; a command
crosses as Guidepup's name for it, and the Guest checks it.

**Guest**:
The far side of the wire, as the Host sees it: a Windows Guest Rig, answered
by its Daemon. No package is named for it. VoiceOver is not a Guest: it runs
in process on the Host.
_Avoid_: VM (for the Guest as a whole)

**Daemon**:
The authenticated process on a Windows Guest Rig that serves NVDA as routes
and launches the Browser Server beside it, started at logon. Also the
`@sr-receipts/daemon` package, which carries it with the Focus Guard, the
Smoke and the Provisioner.
_Avoid_: guest (for the package), server

**Windows Guest Rig**:
A Windows 11 ARM64 virtual machine operated with UTM on a developer's Mac,
which runs NVDA with headed Edge. Each developer has their own.
_Avoid_: the VM, the Windows box, shared rig

**Provisioner**:
The idempotent setup process that turns an approved Windows Guest Rig into a
provisioned rig after Windows' unavoidable first-run and activation steps, and
registers the Daemon to start at logon.

**Bootstrap**:
The one script that brings a Windows Guest Rig to an exact release of the
Daemon, first install or upgrade alike, and hands it to the Provisioner.

**Runtime Manifest**:
The reviewed compatibility record of the exact runtime components installed
by the Provisioner, including the Playwright version a consumer must match.

### Asking a question

**Reader Session**:
One screen reader, started for one test, behind the one interface a test
uses: Guidepup's method names, plus entering a page and capturing a page
action. Built once, in the host, around a reader adapter, so the Transcript,
serialized calls, and rejecting rather than throwing hold on every reader.
VoiceOver in process on a Mac and NVDA through the Guest's Daemon are the two
adapters.
_Avoid_: Execution Target (retired), driver, target

**Browser Server**:
The Playwright browser server the Guest's Daemon launches beside NVDA, which a
test's `page` drives through Playwright's own `connectOptions`.

**Entry**:
Putting a Reader Session on a page's content and proving it, before a test
asks anything. On NVDA it is the Focus Guard; on VoiceOver it is the Item
Chooser sequence returning and the first item having text.

**Focus Guard**:
The proof, at Entry on NVDA, that keystrokes will reach the page's content:
the browser is in front, focus is in the document, and browse mode is on,
each shown by behaviour rather than assumed.

**Capture Window**:
The span during which a page action's speech is recorded, opened before the
action and closed after it. On the wire it is a pair of routes.

**Fixture**:
A committed HTML page shipped with the Daemon, used by the Smoke to prove the
rig without any app.

### Evidence

**Transcript**:
Every call to a Reader Session and its answer, one line each, from start to
stop, with silence named and a failed call recorded as failed. Attached to
the test.

**Environment Stamp**:
The exact operating system, browser, reader and tool builds (and reader
settings) that produced a Transcript, which is what explains a difference
between two runs. Attached to the test.
_Avoid_: environment block, rig info

**Receipt**:
What one test to a real screen reader leaves behind: its Transcript, its
Environment Stamp, and Playwright's own report and trace. A simulated reader
never produces one.
_Avoid_: result (for a simulated reader's output)

**Receipt File**:
The part of a Receipt a person reads and a repository can keep: one file per
test per reader, beside the test's spec, replaced by each run so a change in
what the reader said shows as a change to the file. Its Steps are its body.
_Avoid_: record, recording

**Step**:
One call a test made to a Reader Session, with what the reader said and the
page state the spec asked to see after it. The Transcript holds every Step
and also what the test never asked for: start, Entry and stop.
_Avoid_: line (for a Step), action

**Smoke**:
The Guest's own proof that the rig works right now, as a client of its
Daemon: NVDA, Edge, the Focus Guard and quick navigation on a Fixture,
through the same Reader Session a test uses. Run by the Provisioner, and from
any shell on the Guest.
