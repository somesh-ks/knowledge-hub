/**
 * Voice and size limits. Enforced by the validator and quoted in the writer prompt.
 *
 * A summary runs the four beats in three or four sentences. Two sentences are accepted so a thin
 * source is never padded. `whyWords` applies only to the why line of digests written before the
 * four-beat voice. The `spoken*` limits are for the host's telling of a story. `techCap` is the allowance for the Tech releases section, on top of `cap`.
 */
export const VOICE_LIMITS = {
  headlineWords: 12,
  /**
   * The player bar's chapter label (DigestItem.chapter). A 360px phone's bar holds 161px of title
   * beside the cover and two buttons, about 22 characters; the writer is asked for that, and a
   * label a few over is kept (cut by a letter or two on the narrowest phones).
   */
  chapterWords: 5,
  chapterChars: 22,
  summaryWords: 80,
  summarySentences: 4,
  summaryMinWords: 25,
  summaryMinSentences: 2,
  sentenceWords: 28,
  whyWords: 18,
  spokenWords: 95,
  spokenMinWords: 40,
  /** A hard ceiling in characters, so 24 stories can never outgrow the narration request. */
  spokenChars: 700,
  spokenSentences: 5,
  spokenMinSentences: 3,
  items: { floor: 3, target: [8, 12], cap: 12, weeklyCap: 18, techCap: 5, hardMax: 48 },
} as const;
