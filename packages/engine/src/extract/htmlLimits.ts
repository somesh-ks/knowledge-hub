/** Pages with more elements than this are skipped: real articles stay far below it. */
export const MAX_ELEMENTS = 30_000;
/** Nesting deeper than this is skipped. Readability's cost grows steeply with depth. */
export const MAX_DEPTH = 256;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TAG = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;

/**
 * Cheap, linear check run before any parsing. Parsing and Readability are synchronous, so the
 * fetch timeout cannot interrupt them: a hostile 1.5 MB page of nested elements could otherwise
 * stall the run for many seconds. Counts open tags and tracks nesting without building a tree.
 */
export function htmlTooComplex(html: string): boolean {
  let elements = 0;
  let depth = 0;
  for (const match of html.matchAll(TAG)) {
    if (match[1]) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    elements += 1;
    if (elements > MAX_ELEMENTS) return true;
    if (match[3] || VOID_ELEMENTS.has((match[2] as string).toLowerCase())) continue;
    depth += 1;
    if (depth > MAX_DEPTH) return true;
  }
  return false;
}
