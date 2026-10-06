import { countWords } from "../voice/sentences.js";

/** Silent reading speed used for `read_minutes`. */
export const READ_WORDS_PER_MINUTE = 230;
/** Speech rate used for `listen_minutes`: 2.6 words a second, about 156 a minute. */
export const LISTEN_WORDS_PER_SECOND = 2.6;

export interface TimedFields {
  headline: string;
  summary: string;
  why: string;
}

/** Words in the fields the reader sees and the narrator speaks. */
export function digestWords(items: readonly TimedFields[]): number {
  return items.reduce(
    (sum, item) =>
      sum + countWords(item.headline) + countWords(item.summary) + countWords(item.why),
    0,
  );
}

export function readMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / READ_WORDS_PER_MINUTE));
}

export function listenMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / LISTEN_WORDS_PER_SECOND / 60));
}
