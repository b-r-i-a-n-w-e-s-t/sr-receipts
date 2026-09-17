# @sr-receipts/host

The host's side of sr-receipts: connect to a guest daemon, run scenarios on a
real screen reader, and read back what it said.

## Ownership

This package owns:

- `createClient`, which talks to a guest daemon with its endpoint and bearer
  token
- the wire protocol in `src/protocol.ts`: requests, the NDJSON event stream,
  reports, and health

It does not know how any screen reader is driven, and it depends on nothing but
Node's `fetch`. `@sr-receipts/guest` implements the protocol and depends on this
package for it. A change to `src/protocol.ts` is a change to both packages and
belongs in both changelogs.

## Use

```js
import { createClient } from "@sr-receipts/host";

const rig = createClient({ url: process.env.RIG_URL, token: process.env.RIG_TOKEN });

const report = await rig.run([{ target: "control.html", scenario: "survey" }], {
  onEvent: (event) => { if (event.type === "step") console.log(event.label, event.heard); },
});

if (!report.ok) process.exit(1);
console.log(await rig.transcript(report.runId, report.results[0].transcript));
```

A wrong answer resolves with `ok: false`. A run that broke rejects with a
`RigError`. The guest README documents the routes, the one-run-at-a-time rule,
and what happens when a client hangs up.

## Versioning

Pre-1.0 semantic versioning: a minor version may break the contract, and says
so in [`CHANGELOG.md`](CHANGELOG.md). Private to this repository until an
external consumer exists.

## Tests

```bash
npm test
```

Framing is tested here. The client against a real daemon is tested in
`@sr-receipts/guest`, which can depend on this package.
