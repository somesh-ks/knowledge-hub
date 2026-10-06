export const SNIPPET_MAX = 240;

/**
 * Flatten text to one line and cut it to `max` characters at a word boundary, ending with an
 * ellipsis when anything was removed. The ellipsis counts toward the cap.
 */
export function capSnippet(text: string, max: number = SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = max - 1;
  const slice = flat.slice(0, room + 1);
  const lastSpace = slice.lastIndexOf(" ");
  // Without a usable space (one very long token) fall back to a hard cut.
  const cut = lastSpace >= Math.floor(room / 2) ? slice.slice(0, lastSpace) : flat.slice(0, room);
  return `${cut.replace(/[\s.,;:!?-]+$/, "")}…`;
}
