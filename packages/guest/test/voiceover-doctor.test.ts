import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED, appleScriptControlCheck, checkExact, checkVersion, expectedVoiceOverAsset, preferenceAccessCheck, voiceOverPreferenceDirectory } from "../voiceover/doctor.ts";

test("VoiceOver is supported only on its pinned release family", () => {
  assert.equal(checkVersion("macOS", "26.6.2", SUPPORTED.macOS).ok, true);
  assert.equal(checkVersion("macOS", "27.0", SUPPORTED.macOS).ok, false);
  assert.equal(checkExact("Guidepup", "0.34.0", SUPPORTED.guidepup).ok, true);
  assert.equal(checkExact("Guidepup", "0.33.0", SUPPORTED.guidepup).ok, false);
});

test("doctor exposes its asset and protected-preference diagnostics", () => {
  assert.match(expectedVoiceOverAsset("/tmp/cache"), /voiceover\/25\/0\.0\.1-VoiceOver4\/guidepup-voiceover-preferences-macos-26\.dmg$/);
  assert.match(voiceOverPreferenceDirectory("/Users/x"), /Group Containers\/group\.com\.apple\.VoiceOver\/Library\/Preferences$/);
  const check = preferenceAccessCheck("/definitely/not/here");
  assert.equal(check.ok, false);
  assert.match(check.actual, /not\/here/);
});

test("doctor reports AppleScript control, the prerequisite VoiceOver capture depends on", () => {
  const check = appleScriptControlCheck("/definitely/not/here/default.plist");
  assert.equal(check.name, "VoiceOver AppleScript control");
  assert.equal(check.ok, false);
  assert.match(check.actual, /no VoiceOver preferences at/);
});
