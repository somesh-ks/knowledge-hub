/**
 * The search a picker's list applies (scripts/picker.ts). Pure, so it is unit tested and the page
 * script stays small.
 */

/** Lower case with accents taken off, so "sao paulo" finds "São Paulo". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Whether every word of the query is somewhere in the text, in any order: "gmt+2 stock" finds
 * "Stockholm (GMT+2)", and "british female" finds a voice by its accent and gender. An empty query
 * keeps everything.
 */
export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(text);
  return words.every((word) => haystack.includes(word));
}

/** What the live region says about the open list: "12 voices", "No voice matches". */
export function pickerCount(count: number, noun: string): string {
  if (count === 0) return `No ${noun} matches`;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The line a search that finds nothing shows in the list. */
export function pickerNoMatch(query: string, noun: string): string {
  return `No ${noun} called “${query.trim()}”`;
}
