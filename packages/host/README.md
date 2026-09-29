# @sr-receipts/host

The Mac's side of sr-receipts: the reader interface a test uses, the wire to
a guest daemon, and NVDA as a session over that wire.

## Ownership

This package owns:

- `ReaderSession` in `src/protocol.ts`: the one interface a test sees for
  either reader, with Guidepup's method names
- the wire protocol, also in `src/protocol.ts`: the daemon's routes and their
  bodies
- `connectReader`, a client for those routes, and `createNvdaSession`, NVDA
  as a `ReaderSession` built on it

It does not know how any screen reader is driven, and it depends on nothing
but Node's `fetch`. `@sr-receipts/guest` implements the protocol and depends
on this package for it. A change to `src/protocol.ts` is a change to both
packages and belongs in both changelogs.

## Use

Most consumers reach this through the `reader` fixture in
[`@sr-receipts/playwright`](../playwright/README.md). Directly:

```js
import { createNvdaSession } from "@sr-receipts/host";

const nvda = createNvdaSession({ url: process.env.RIG_URL, token: process.env.RIG_TOKEN });
await nvda.start();
await nvda.enter(page);                        // a Playwright page, or anything with title(), bringToFront(), evaluate()
const { spoken } = await nvda.capture(() => page.getByRole("checkbox").first().click());
console.log(spoken, await nvda.next());
await nvda.stop();
console.log(nvda.transcript.join("\n"));
```

`enter` throws with the guest's whole diagnosis when the guards fail. Every
other call returns what the reader said, `""` for silence, and the transcript
names silence. A refused request is a `RigError` carrying the status; a reader
failure on the guest arrives with its cause chain.

## Versioning

Pre-1.0 semantic versioning: a minor version may break the contract, and says
so in [`CHANGELOG.md`](CHANGELOG.md). Private to this repository until an
external consumer exists.

## Tests

```bash
npm test
```

The client and the NVDA session against a fake daemon. The daemon itself is
tested in `@sr-receipts/guest`, which can depend on this package.
