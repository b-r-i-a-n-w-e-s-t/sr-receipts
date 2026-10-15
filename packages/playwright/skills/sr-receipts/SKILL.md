---
name: sr-receipts
description: "Get a receipt for what a real screen reader said, by driving NVDA on a Windows Guest Rig or VoiceOver on this Mac from a repo's Playwright specs through sr-receipts. Use when asked what NVDA or VoiceOver announces, to reproduce or settle a screen reader bug, to compare markup variants under a reader, or when a claim about announced speech rests on reasoning from the DOM or source."
---

# sr-receipts

A **receipt** is the reader's own words for one action, with the environment that produced them. This skill is the method for getting receipts that settle a question. The API, the config and the rig are documented elsewhere; read them there:

- `node_modules/@sr-receipts/playwright/README.md` in the consuming repo: installing, the receipts config, the `reader` fixture, the matchers, reading a report.
- [Operating the Windows Guest Rig](https://github.com/b-r-i-a-n-w-e-s-t/sr-receipts/blob/main/docs/operating-the-rig.md): setting up the guest, `.env.rig`, the health check, and what breaks a run.

The consuming repo's receipts setup is its Playwright config whose projects set `readerOptions`, usually `playwright.receipts.config.ts`, and that config's `testDir`. If there is none, the README's "Installing it in a consumer" is the first step, and it is the user's to approve.

## Steps

1. **Preflight.** Done when all three hold:
   - The rig answers: `set -a; . ./.env.rig; set +a; curl -s -H "Authorization: Bearer $RIG_TOKEN" "$RIG_URL/health"` (NVDA only).
   - `npx playwright --version` shares its major.minor with the `playwright-core` in that answer's stamp (NVDA only).
   - Exactly one process listens on the dev server's port: `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

   A mismatch is the user's to resolve: installing on the guest is a remote write and needs their go-ahead each time.
2. **Frame the question as variants and a control.** Write down the one thing that differs between variants, and a control variant whose answer is already known. A reader question usually comes down to one attribute or one timing, so build a static fixture where that is the only variable (see "Fixtures"). Done when every hypothesis in play predicts different speech for at least one variant.
3. **Write the spec** in the receipts directory, from [`references/record-spec.ts`](references/record-spec.ts). Put everything you will filter on in the test title. Record, and assert only what the question is about: a recording spec that passes still carries the receipt.
4. **Smoke one test** with `--grep` (check the filter with `--list` first) and read its record end to end. Done when the entry lines show the reader on the page, the control behaves as known, and the page log shows the keys arrived.
5. **Run the matrix** in the background: about 25 seconds a test, one worker. Done when every test has a record file.
6. **Read every record**, pairing speech with the DOM column and the page log. Repeat any cell the conclusion leans on, and any surprise, at least three more times before reporting it.
7. **Report** each finding with how it was established (heard on the rig, read from the DOM, or inferred), the pace it was measured at, the run count, and what the rig cannot show.

## Choosing the call

| To learn | Use | Know |
| --- | --- | --- |
| What one key or command makes the reader say | `reader.press(key)`, `reader.perform(command)` | Each waits about a second of silence, so a string of presses is slow typing. |
| What the reader says while someone types | `reader.type(text, { delay })` | A `delay` is NVDA only. The real gap is the delay plus 20 to 40 ms; read it from the page log. |
| What a page action makes the reader say | `reader.capture(() => page...)` | Move the reader with `locator.focus()` inside it; neither reader follows a click. |
| Where the reader's focus is | `reader.perform('reportCurrentFocus')` | NVDA+Tab. The direct probe for focus-object questions; DOM focus and reader focus can differ. |
| What the page did | `page.evaluate` after each step, and a page log | See "Fixtures". |

Keys a reader must hear go through the reader. `page.keyboard` injects into the browser, below Windows' input queue, so NVDA neither echoes nor intercepts those keys.

## Fixtures

- **Serve a static page from the spec** with `page.route('**/__name/page.html*', route => route.fulfill(...))` and `goto` it under the project's `baseURL`. It loads as a top-level document on the dev server's origin, with no file to add to the app.
- **One page, variant by query string**, so every variant shares its markup.
- **Give the page a title, an `h1` and a `main`**: the entry guard proves browse mode with them.
- **Have the page log itself**: push `performance.now()` with each `keydown`, `input` and observed attribute change onto `window.__log`, and write it into the record. It is the only measure of real key spacing and of what the DOM held when the reader spoke.
- **Model the real component's node lifetime.** A reader re-announces a rebuilt node and stays silent on a kept one, so a fixture that rebuilds its list answers a different question from a component that keeps it.

## Reading speech

- **A returned string is speech sent, joined.** NVDA's utterances are joined with `. `. Speech a later key would have cut off is still in the string, so the rig shows what was queued; a person listening settles what was heard.
- **The window closes after a second of silence.** An announcement that lands later belongs to the next call or to nothing. Leave a debounced announcement out of a conclusion unless a call was held open for it.
- **Guidepup presses Control before each NVDA call** to stop speech. It appears in the page log as `keydown Control`.
- **`Enter` after focusing an input puts NVDA in focus mode. `Escape` takes it back out**, after which letters are browse-mode commands. Speech such as "no next annotation" means a letter was taken as a command and the page never received it: check the input's value.
- **NVDA settings may persist across tests.** A toggle such as `speakTypedCharacters` (NVDA+2) cycles three states and says the new one; cycle it all the way round so the test ends where it started.
- **The HTML report is replaced by the next run**, and passing `--reporter` on the command line means it is never written. Leave the config's reporters alone, and write each record to a file from the spec, as the template does.

## VoiceOver

A `voiceover` project takes over this Mac's keyboard and speech while it runs, and must be launched from the application holding the grants in `node_modules/@sr-receipts/voiceover/README.md`. Ask the user before running one.

## Guest and secrets

Reading the guest is fine. Writing to it, and restarting its daemon, need the user's go-ahead. `.env.rig` and the daemon's startup output contain the rig token: redact it from any command output you print.
