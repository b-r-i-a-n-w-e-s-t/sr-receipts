# sr-receipts

The product that runs real screen readers against web pages, on the desktops
those readers live on, and keeps what each one said as evidence. Formerly named
Dogwalk.

## Language

### Where things run

**Host**:
The machine a developer works on, and the `@sr-receipts/host` package that
connects from it to a Guest's daemon. It owns the wire protocol and knows
nothing about any screen reader.

**Guest**:
The side that runs a screen reader on its own interactive desktop, and the
`@sr-receipts/guest` package. It holds every Execution Target, including the
local VoiceOver one, so "guest" means the reader's side of the wire rather than
a virtual machine.
_Avoid_: VM (for the Guest as a whole)

**Windows Guest Rig**:
The supported Windows 11 ARM64 virtual machine operated with UTM on a Mac, which
runs NVDA with headed Firefox.
_Avoid_: the VM, the Windows box

**Provisioner**:
The idempotent setup process that turns an approved Windows Guest Rig into a
provisioned rig after Windows' unavoidable first-run and activation steps.

**Runtime Manifest**:
The reviewed compatibility record of the exact runtime components installed by
the Provisioner.

**Execution Target**:
One screen reader with its browser on its own desktop, which executes a
Scenario and produces its observed speech: NVDA with Firefox on the Windows
Guest Rig, or VoiceOver with Safari on a Mac.
_Avoid_: target (on its own), reader (when the browser and desktop are meant too)

### Asking a question

**Target**:
The page a Run Request asks about: a Fixture, or any `http(s)` URL.
_Avoid_: using "target" for an Execution Target

**Fixture**:
A committed HTML page in the Guest, built to isolate one question, whose bytes
are hashed into every Transcript that uses it.

**Scenario**:
What to ask a Target: a sequence of Steps written in one reader's commands, with
the Expectations and Checks that judge the answers.
_Avoid_: test, script

**Step**:
One reader command or key press in a Scenario, and the announcement it draws.

**Run Request**:
One Target paired with one Scenario.
_Avoid_: job

**Run**:
One or more Run Requests executed in turn on one Execution Target, identified by
the time it started.

**Queue**:
A list of Run Requests written as text, one `target :: scenario` per line.

### Evidence and judgement

**Transcript**:
The human-readable record of one Run Request: the Environment Stamp, the guards'
findings, and what the reader said at each Step.

**Environment Stamp**:
The exact operating system, browser, reader and tool builds (and reader
settings) that produced a Transcript, which is what explains a difference
between two runs.
_Avoid_: environment block, rig info

**Receipt**:
What one Run Request to a real screen reader produced: the Verdict, the
Transcript, the Environment Stamp, and what was heard at each Step. A simulated
reader never produces one.
_Avoid_: result (for a simulated reader's output)

**Expectation**:
What must be true of one Step's announcement on any Target.

**Check**:
What must be true across a whole Transcript, such as how many announcements
match a pattern.

**Baseline**:
What a Run is compared with: the words one Execution Target said for one Target
and Scenario, accepted as right.
_Avoid_: golden, expected output

**Snapshot**:
The Guest's committed file form of a Baseline.

**Verdict**:
The outcome of a Run Request or a Run: PASS, FAIL (a finding about the page), or
broke (the question went unanswered).

**Focus Guard**:
The proof, before any Step runs, that keystrokes will reach the Target's page
and not some other window.

**Focus Watch**:
The repeated check during a Run that nothing has taken the foreground since the
Focus Guard passed.

**Baseline Identity**:
The compatibility identity that determines whether an observed accessibility
transcript may be compared with a committed baseline.
