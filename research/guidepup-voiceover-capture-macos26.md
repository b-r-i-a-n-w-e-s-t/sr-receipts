# Guidepup VoiceOver capture on macOS 26

Research date: current session (repository metadata and upstream Guidepup sources inspected at their current published/tagged state).

## Executive finding

> [!IMPORTANT]
> **Resolved. The premise of this research was wrong, and the rest of the
> document should be read with that in mind.** There was no Guidepup capture
> defect on macOS 26.6.2. `SCREnableAppleScript` was `false` in the live
> preference store, which disables VoiceOver's *entire* scripting dictionary:
> the minimal probe (`npm run voiceover:capture-probe`) showed property reads
> failing with `-1728` and commands with `-1708`, while start, stop, and
> keystrokes kept working because those go through System Events instead. That
> is exactly the missing prerequisite in "Officially supported" item 1 below.
>
> With the preference enabled, the same Guidepup 0.34.0 captures real speech and
> cursor text, and `npm run voiceover:smoke` passes. The two remaining problems
> were unrelated to capture: a stale string match in this repository's own Item
> Chooser adapter, and an intermittent Guidepup start race (`-600`) resembling
> upstream issue #101. See `voiceover/README.md`.
>
> The findings below remain accurate as a description of *how* Guidepup captures
> speech and of the upstream record. Do not cite this document as evidence that
> VoiceOver capture is broken on macOS 26.

**There is no documented, supported fix for the reported speech/cursor-capture failure on macOS 26.6.2.** The pinned Guidepup version is `0.34.0` ([`package.json`](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/blob/ffdb797/package.json#L20-L23); the lockfile resolves the same version at [`package-lock.json`](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/blob/ffdb797/package-lock.json#L36-L45)). Guidepup's current support matrix claims macOS 26 (Tahoe), but that is a platform/version claim, not evidence that every VoiceOver AppleScript property works on every 26.x point release ([support matrix](https://www.guidepup.dev/docs/reference/support-matrix)).

The supported prerequisite is still **Allow VoiceOver to be controlled with AppleScript**: Guidepup's setup source enables `SCREnableAppleScript` ([`enableAppleScriptControlSystemDefaults.ts`](https://github.com/guidepup/setup/blob/main/src/commands/setup/macOS/enableAppleScriptControlSystemDefaults.ts#L1-L15)), and the repository's setup notes require the corresponding VoiceOver Utility setting ([`voiceover/README.md`](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/blob/ffdb797/voiceover/README.md#L12-L23)). That prerequisite explains successful control and does not, by itself, establish that VoiceOver's `last phrase` object is available. No Guidepup release note, issue, PR, or documented API found in this research supplies a fix for `content of last phrase` returning AppleScript `-1728` on Tahoe 26.6.2.

## Evidence: what the pinned Guidepup code actually captures

### Speech

Guidepup's macOS implementation constructs this AppleScript for `lastSpokenPhrase()`:

```applescript
tell application "VoiceOver"
return content of last phrase
end tell
```

The exact source is [`src/macOS/VoiceOver/lastSpokenPhrase.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/lastSpokenPhrase.ts#L1-L19). The `last phrase` reference is therefore a VoiceOver scripting-dictionary object reference; `content` is read from that object. If VoiceOver has no such object at the time of the Apple event, AppleScript reports `errAENoSuchObject` (`-1728`) rather than returning speech text. The latter interpretation is an inference from the reported AppleScript error and the script's object reference; Guidepup itself does not document a second speech transport in this code path.

`spokenPhraseLog()` is not a separate VoiceOver API. `VoiceOverClient` polls `lastSpokenPhrase()` after each action, cleans the result, and appends the captured string to its in-memory log ([`VoiceOverClient.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/VoiceOverClient.ts#L71-L88), [`VoiceOverClient.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/VoiceOverClient.ts#L176-L238)). Its error handling swallows failed polls and returns an empty result when no non-empty phrase is collected ([same source](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/VoiceOverClient.ts#L185-L200)). Thus `lastSpokenPhrase() === ""` and `spokenPhraseLog() === [""]` are expected consequences of this failure mode, not evidence that the facade used another capture mechanism.

Guidepup has explicitly acknowledged that this is polling of VoiceOver's “last phrase” interface, including timing and missed-output limitations, in issue [#79](https://github.com/guidepup/guidepup/issues/79). That issue discusses flakiness and performance of polling; it does not report `-1728` or provide a Tahoe fix.

### Cursor/item text

Guidepup constructs this separate AppleScript for `itemText()`:

```applescript
tell application "VoiceOver"
return text under cursor of vo cursor
end tell
```

The exact source is [`src/macOS/VoiceOver/itemText.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/itemText.ts#L1-L19). The object model here is VoiceOver's `vo cursor` and its `text under cursor` property, not the `last phrase` object. `VoiceOverClient` polls it independently and deliberately swallows errors while retrying ([`VoiceOverClient.ts`](https://github.com/guidepup/guidepup/blob/0.34.0/src/macOS/VoiceOver/VoiceOverClient.ts#L159-L175)). Therefore empty `itemText()` alongside empty speech is consistent with the VoiceOver AppleScript object model not exposing usable state to the automation process, but the reported `-1728` specifically identifies the speech script; it does not prove that the cursor property fails for the same internal reason.

The public `screenReader` facade does not create an alternate macOS capture path: Guidepup's supported real-reader documentation identifies VoiceOver as the macOS implementation and `voiceOver` as its API ([real screen-reader guide](https://www.guidepup.dev/docs/screen-reader-testing/testing-with-real-screen-readers#voiceover-and-nvda)). The repository's local failure report likewise observes delegation to `voiceOver`; no source inspected here shows a fallback speech or cursor API.

## Required state and settings

**Evidence:** Guidepup's setup code enables the `SCREnableAppleScript` VoiceOver preference with `defaults write com.apple.VoiceOver4/default SCREnableAppleScript -bool true` ([setup source](https://github.com/guidepup/setup/blob/main/src/commands/setup/macOS/enableAppleScriptControlSystemDefaults.ts#L4-L10)). Guidepup's setup error says manual interaction is required if it cannot enable that control ([`errors.ts`](https://github.com/guidepup/setup/blob/main/src/errors.ts#L1-L12)), and the VoiceOver guide lists macOS, VoiceOver, a supported browser, Node.js, and `@guidepup/guidepup` as requirements ([testing VoiceOver](https://www.guidepup.dev/docs/screen-reader-testing/testing-voiceover#requirements)). The local project correctly calls out the human VoiceOver Utility setting and Automation permissions ([`voiceover/README.md`](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/blob/ffdb797/voiceover/README.md#L12-L27)).

**Not established by the sources:** I found no Guidepup documentation requiring a speech-log preference, caption panel, or a separate “speech logging” switch for `content of last phrase`; the implementation directly queries the VoiceOver scripting object. The source also does not state that opening Caption Panel creates or repairs `last phrase`. Treat claims that those settings fix this specific error as unsupported hacks/speculation, not a supported workaround.

## macOS 26 compatibility investigation

### Guidepup's own issue/PR/release record

- A repository-wide GitHub issue search for `"-1728"` returned zero Guidepup issues ([GitHub search](https://api.github.com/search/issues?q=repo%3Aguidepup%2Fguidepup+%22-1728%22)). This is evidence of no indexed report, not proof that no user has ever encountered it.
- Search for `"last phrase"` finds the polling discussion [#79](https://github.com/guidepup/guidepup/issues/79) and an open feature proposal [#129](https://github.com/guidepup/guidepup/issues/129). Issue #129 proposes replacing AppleScript polling with event-driven speech capture using external macOS speech-capture assets; it is a proposal, not a released fix. The issue's stated non-goal is replacing AppleScript for VoiceOver control ([#129 body](https://github.com/guidepup/guidepup/issues/129)).
- The closest Tahoe-labelled issue found is [#101](https://github.com/guidepup/guidepup/issues/101), about VoiceOver not fully quitting on Tahoe 26.0.1, not speech capture or `-1728`. Its maintainer comments say Tahoe/Sequoia testing was blocked by VoiceOver control problems; it does not claim a capture fix.
- The Sequoia configuration issue [#89](https://github.com/guidepup/guidepup/issues/89) records that VoiceOver preferences moved into a group container on Sequoia and that `defaults` no longer works for those settings. It concerns preference configuration, not proof of a `last phrase` regression on macOS 26. It does reinforce that OS changes can affect Guidepup's preference plumbing.
- The newest published Guidepup release is **0.34.0**, according to the release API ([release `0.34.0`](https://api.github.com/repos/guidepup/guidepup/releases/tags/0.34.0)). Its release notes say only “feat: upgrade NVDA” and “Guidepup now uses NVDA 2026.2”; they contain no VoiceOver, Tahoe, `-1728`, or speech-capture fix. The immediately preceding VoiceOver-relevant release, 0.33.2, says “feat: VoiceOver debug logging” ([release `0.33.2`](https://github.com/guidepup/guidepup/releases/tag/0.33.2)), not a capture fix.

### Support boundary

The current Guidepup support matrix claims VoiceOver support on macOS 12 (Monterey), 13 (Ventura), 14 (Sonoma), 15 (Sequoia), and 26 (Tahoe) ([support matrix](https://www.guidepup.dev/docs/reference/support-matrix#runtime-compatibility)). It says each Guidepup release's `manifest.json` selects the supported screen-reader asset and that the asset should be reinstalled after upgrading. The repository README similarly advertises badges for Sonoma, Sequoia, and Tahoe ([upstream README](https://github.com/guidepup/guidepup/blob/main/README.md#L8-L17)).

This is the official boundary found: **macOS 26 is claimed as supported.** It does not promise every point release, nor does it document the AppleScript dictionary's behavior when `last phrase` is unavailable. The tested 26.6.2 failure is therefore a compatibility defect or unverified edge within a claimed support family, not evidence that the platform is officially outside Guidepup's boundary.

## Fix/workaround classification

### Officially supported

1. Ensure **Allow VoiceOver to be controlled with AppleScript** is enabled, and grant the invoking terminal/helper the required macOS Accessibility/Automation permissions. These are documented prerequisites in Guidepup/setup and this repository ([setup source](https://github.com/guidepup/setup/blob/main/src/commands/setup/macOS/enableAppleScriptControlSystemDefaults.ts#L4-L10); [`voiceover/README.md`](https://github.com/b-r-i-a-n-w-e-s-t/a11y-nvda-testing/blob/ffdb797/voiceover/README.md#L12-L27)).
2. Upgrade only after separately validating the dependency and rerun Guidepup's supported asset installation, as the support matrix instructs ([support matrix](https://www.guidepup.dev/docs/reference/support-matrix#runtime-compatibility)). At research time, the project is already pinned to newest release `0.34.0`; its notes do not promise a VoiceOver capture change ([release API](https://api.github.com/repos/guidepup/guidepup/releases/tags/0.34.0)).

### Unsupported hacks/speculation

Changing undocumented VoiceOver preference keys, opening Caption Panel, modifying protected VoiceOver preference files, bypassing TCC/SIP, or using a different speech-logging/captioning process may be useful experiments, but no primary Guidepup or Apple source found here documents them as a fix for this error. Do not present them as supported workarounds. In particular, the existence of `SCREnableAppleScript` proves a control prerequisite, not that it manufactures a `last phrase` object.

### No known fix

For the exact observed combination (macOS 26.6.2, bundled VoiceOver, Safari 26.6.2, Guidepup 0.34.0, successful start/control but `content of last phrase` repeatedly returning `-1728`), the primary-source record contains no released fix, documented alternate API, or confirmed preference workaround. The strongest upstream direction is open issue #129's proposed event-driven speech-capture integration ([#129](https://github.com/guidepup/guidepup/issues/129)); it is not available as a Guidepup release according to the 0.34.0 release notes ([release `0.34.0`](https://api.github.com/repos/guidepup/guidepup/releases/tags/0.34.0)).

## Recommendation

Keep this target marked as a blocked compatibility spike rather than weakening the evidence contract or adding undocumented preference mutations. Record the exact AppleScript error and preserve the successful-control/failed-capture distinction. Revisit when Guidepup closes #129 or publishes a release explicitly changing VoiceOver speech capture; until then, use the existing NVDA target for required transcript evidence and treat any local workaround as experimental.

This note intentionally does not repeat the Guidepup/Playwright architecture research; see [`research/guidepup-playwright-dogwalk.md`](guidepup-playwright-dogwalk.md) for that material.
