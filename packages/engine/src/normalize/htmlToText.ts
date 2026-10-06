const cp = (code: number): string => String.fromCodePoint(code);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: cp(0x2026),
  mdash: cp(0x2014),
  ndash: cp(0x2013),
  lsquo: cp(0x2018),
  rsquo: cp(0x2019),
  ldquo: cp(0x201c),
  rdquo: cp(0x201d),
  copy: cp(0xa9),
  reg: cp(0xae),
  trade: cp(0x2122),
  times: cp(0xd7),
  middot: cp(0xb7),
  bull: cp(0x2022),
  rarr: cp(0x2192),
  larr: cp(0x2190),
};

const BLOCK_TAGS =
  "address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

/** Control characters and invisible direction or width marks that can disguise or reorder text. */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

function stripHidden(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!HIDDEN_RANGES.some(([low, high]) => code >= low && code <= high)) out += char;
  }
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1]?.toLowerCase() === "x";
      const code = isHex ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return " ";
      return cp(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Single spaces, trimmed, with hidden characters removed. For titles and other one-line text. */
export function collapseWhitespace(text: string): string {
  return stripHidden(text).replace(/\s+/g, " ").trim();
}

/**
 * Plain text from feed or page HTML. The result is data only: it is never rendered as HTML, so
 * regex tag removal is enough, and anything that looks like markup in the output is just text.
 * Paragraph breaks survive as blank lines so a snippet can end on a sentence.
 */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const withBreaks = withoutBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  return stripHidden(decodeEntities(stripped))
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();
}
