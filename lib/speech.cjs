/**
 * Reading NVDA's speech without losing any of it.
 *
 * `nvda.spokenPhraseLog()` is cumulative: it returns everything spoken since the
 * session started, and grows as NVDA talks. The obvious `(await
 * nvda.spokenPhraseLog()).at(-1)` therefore answers "the last phrase NVDA has
 * said", not "what NVDA said in response to that keystroke". When one command
 * produces several phrases — and table navigation routinely does, announcing the
 * column header, the coordinate and the content as separate phrases — every
 * phrase but the last is silently dropped from the transcript.
 *
 * A `SpeechLog` keeps a cursor into that array and hands back only the phrases
 * added since it last looked, so a step records the whole announcement.
 */
class SpeechLog {
  #nvda;
  #seen = 0;

  constructor(nvda) {
    this.#nvda = nvda;
  }

  /**
   * Move the cursor to the end without returning anything. Call this after any
   * setup that makes NVDA talk but whose speech is not part of a step.
   */
  async discard() {
    this.#seen = (await this.#nvda.spokenPhraseLog()).length;
  }

  /** Every phrase spoken since the last `since()` or `discard()`. */
  async since() {
    const all = await this.#nvda.spokenPhraseLog();
    const fresh = all.slice(this.#seen);
    this.#seen = all.length;
    return fresh;
  }

  /**
   * The same phrases as one transcript-ready block. Multi-phrase announcements
   * keep one phrase per line; silence is named explicitly, because a blank line
   * in a transcript is indistinguishable from a formatting accident.
   */
  async heard() {
    const fresh = await this.since();
    return fresh.length === 0 ? SILENCE : fresh.join("\n");
  }
}

/**
 * Silence is named rather than left blank, because a blank line in a transcript
 * is indistinguishable from a formatting accident — and because silence is a
 * result the rig cares about: it is what a quick-navigation command answers in
 * focus mode, and what a missing accessible name sounds like.
 */
const SILENCE = "(silence)";

module.exports = { SpeechLog, SILENCE };
