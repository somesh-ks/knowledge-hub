function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, punctuation to spaces, single spaces. For names and handles. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Lowercase with collapsed whitespace, punctuation kept. For substring matching of phrases. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Case-insensitive match of a whole word or phrase, so "motion" does not fire inside "emotion".
 * A plural ending is allowed because a taste for "shader" covers "shaders". Patterns with
 * punctuation ("three.js") are matched literally.
 */
export function keywordRegExp(keyword: string): RegExp {
  const escaped = escapeRegExp(normalizeText(keyword)).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu");
}

/** True when the normalized text contains the phrase anywhere. Used for disliked patterns. */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = normalizeText(phrase);
  return needle !== "" && normalizeText(text).includes(needle);
}

/** True when an item's author matches a preferred name or handle as whole words. */
export function authorMatches(author: string | undefined, preferred: string): boolean {
  if (!author) return false;
  const wanted = normalizeName(preferred);
  if (wanted.length < 4) return false;
  return ` ${normalizeName(author)} `.includes(` ${wanted} `);
}
