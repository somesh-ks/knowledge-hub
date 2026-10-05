/** Words as a reader counts them: whitespace-separated tokens that contain a letter or digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

// A period after these does not end a sentence.
const ABBREVIATION_END =
  /(?:\b(?:e\.g|i\.e|vs|etc|approx|fig|no|inc|ltd|dr|mr|ms|mrs|st|cf)|\b[A-Za-z](?:\.[A-Za-z])+)\.$/i;
const BOUNDARY = /(?<=[.!?])["')\]]*\s+(?=["'([]?[\p{Lu}\p{N}])/u;

/**
 * Split prose into sentences. A boundary needs end punctuation, then whitespace, then a capital
 * or digit, so version numbers (2.0), file names (Next.js) and common abbreviations stay whole.
 */
export function splitSentences(text: string): string[] {
  const parts = text
    .trim()
    .split(BOUNDARY)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && ABBREVIATION_END.test(previous)) {
      merged[merged.length - 1] = `${previous} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}
