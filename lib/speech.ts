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

/**
 * Silence is named rather than left blank, because a blank line in a transcript
 * is indistinguishable from a formatting accident — and because silence is a
 * result the rig cares about: it is what a quick-navigation command answers in
 * focus mode, and what a missing accessible name sounds like.
 */
export const SILENCE = "(silence)";

/**
 * The part of NVDA a `SpeechLog` needs. Narrower than guidepup's own type on
 * purpose: it is the whole seam the unit tests substitute, so keeping it to one
 * method keeps the fakes honest.
 */
export interface SpeechSource {
  spokenPhraseLog(): Promise<string[]>;
}

export class SpeechLog {
  readonly #source: SpeechSource;
  #seen = 0;

  constructor(source: SpeechSource) {
    this.#source = source;
  }

  /**
   * Move the cursor to the end without returning anything. Call this after any
   * setup that makes NVDA talk but whose speech is not part of a step.
   */
  async discard(): Promise<void> {
    this.#seen = (await this.#source.spokenPhraseLog()).length;
  }

  /**
   * Every phrase spoken since the last `since()` or `discard()`.
   *
   * Blank phrases are dropped. NVDA does emit them — an empty string in the
   * middle of the log, observed while in focus mode on a page whose focused
   * object reports an object-replacement character — and a blank phrase carries
   * no more information than no phrase at all. Keeping them made `heard()`
   * return `""` instead of `SILENCE`, which in turn made the focus guard's
   * `heard !== SILENCE` test read a silent mode probe as proof of browse mode.
   * A whole run then proceeded in focus mode and recorded 60 blank steps.
   */
  async since(): Promise<string[]> {
    const all = await this.#source.spokenPhraseLog();
    const fresh = all.slice(this.#seen).filter((phrase) => phrase.trim() !== "");
    this.#seen = all.length;
    return fresh;
  }

  /**
   * The same phrases as one transcript-ready block. Multi-phrase announcements
   * keep one phrase per line; silence is named explicitly.
   */
  async heard(): Promise<string> {
    const fresh = await this.since();
    return fresh.length === 0 ? SILENCE : fresh.join("\n");
  }
}
