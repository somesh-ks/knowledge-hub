/** Prefixes that are labels, not content: "Show HN: Foo" and "Foo" are the same title. */
const LABEL_PREFIX = /^(show hn|ask hn|tell hn|launch hn)\s*[:-]\s*/i;

/** Minimum distinct tokens for a title to take part in near-duplicate matching. */
export const MIN_TOKENS = 3;

/**
 * Lowercase word tokens of a title. Punctuation at the edges of a token is dropped but inner
 * punctuation stays, so version numbers such as "4.21.2" remain one token and two releases of
 * the same library do not look identical.
 */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of title.replace(LABEL_PREFIX, "").toLowerCase().split(/\s+/)) {
    const token = part.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, "");
    if (token !== "") tokens.add(token);
  }
  return tokens;
}

/** Jaccard similarity of two token sets: shared tokens over all distinct tokens. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}
