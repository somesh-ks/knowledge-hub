/** Full text sent to the writer is capped near this size to bound spend and distraction. */
export const MAX_TEXT_CHARS = 10_000;

export interface Truncated {
  text: string;
  truncated: boolean;
}

/**
 * Cut `text` to at most `max` characters at the last paragraph boundary, so the writer never sees
 * half a paragraph. When no boundary sits in the back half, cut at a sentence end, then a word.
 */
export function truncateAtParagraph(text: string, max: number = MAX_TEXT_CHARS): Truncated {
  if (text.length <= max) return { text, truncated: false };
  const window = text.slice(0, max);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= max * 0.5)
    return { text: window.slice(0, paragraph).trimEnd(), truncated: true };
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence >= max * 0.6) return { text: window.slice(0, sentence + 1), truncated: true };
  // The last word is whole only when whitespace follows the window.
  if (/\s/.test(text[max] ?? "")) return { text: window.trimEnd(), truncated: true };
  const space = window.lastIndexOf(" ");
  return { text: window.slice(0, space > 0 ? space : max).trimEnd(), truncated: true };
}
