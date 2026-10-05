const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how if in into is it its " +
    "just more most no not of on one only or other our out over so some such than that the their then there " +
    "these they this those to up was we were what when where which while who why will with would you your"
  ).split(" "),
);

const TOKEN = /\d+(?:\.\d+)+|[\p{L}\p{N}]+/gu;

/** Lowercase content words and numbers, lightly stemmed so "springs" matches "spring". */
export function contentTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(TOKEN)) {
    let token = match[0];
    if (STOPWORDS.has(token)) continue;
    if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss"))
      token = token.slice(0, -1);
    if (token.length < 2 && !/\d/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** Numbers carry the claims most worth checking, so they count double. */
function weight(token: string): number {
  return /\d/.test(token) ? 2 : 1;
}

export interface Excerpt {
  text: string;
  /** Weighted share of the sentence's content tokens found in the window, 0 to 1. */
  overlap: number;
}

export interface ExcerptOptions {
  windowWords?: number;
  step?: number;
}

export const EXCERPT_WINDOW_WORDS = 160;
export const EXCERPT_STEP = 40;

/**
 * The window of the source with the highest token overlap with the sentence. Windows are
 * `windowWords` words wide and start every `step` words; the earliest best window wins ties.
 * Short sources come back whole.
 */
export function bestExcerpt(
  source: string,
  sentence: string,
  options: ExcerptOptions = {},
): Excerpt {
  const windowWords = options.windowWords ?? EXCERPT_WINDOW_WORDS;
  const step = options.step ?? EXCERPT_STEP;
  const words = Array.from(source.matchAll(/\S+/g)).map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  if (words.length === 0) return { text: "", overlap: 0 };

  const wanted = new Set(contentTokens(sentence));
  const total = [...wanted].reduce((sum, token) => sum + weight(token), 0);
  const slice = (from: number, to: number): string =>
    source.slice(
      words[from]?.start ?? 0,
      words[Math.min(to, words.length) - 1]?.end ?? source.length,
    );

  if (words.length <= windowWords || total === 0) {
    const text = slice(0, Math.min(windowWords, words.length));
    return { text, overlap: total === 0 ? 0 : overlapOf(wanted, total, text) };
  }

  let best: { from: number; overlap: number } = { from: 0, overlap: -1 };
  const lastStart = words.length - windowWords;
  for (let from = 0; ; from += step) {
    const start = Math.min(from, lastStart);
    const overlap = overlapOf(wanted, total, slice(start, start + windowWords));
    if (overlap > best.overlap) best = { from: start, overlap };
    if (start === lastStart) break;
  }
  return { text: slice(best.from, best.from + windowWords), overlap: Math.max(0, best.overlap) };
}

function overlapOf(wanted: ReadonlySet<string>, total: number, text: string): number {
  const present = new Set(contentTokens(text));
  let hit = 0;
  for (const token of wanted) if (present.has(token)) hit += weight(token);
  return hit / total;
}
