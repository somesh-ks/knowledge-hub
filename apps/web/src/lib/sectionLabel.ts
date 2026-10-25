/**
 * Section names as the reader sees them, in sentence case like every other label. Older digests and
 * the built-in names carry title case ("AI Products"); only those known names are mapped, so a
 * topic's own name, which may hold a proper noun, is shown as it was written.
 */
const SENTENCE_CASE: Record<string, string> = {
  "Design Engineering": "Design engineering",
  "AI Products": "AI products",
  "Tech Product Launches": "Tech product launches",
};

export function sectionLabel(title: string): string {
  return SENTENCE_CASE[title] ?? title;
}

/** A section as the tabs and the contents column name it: its id for the anchor, and its label. */
export interface SectionRef {
  slug: string;
  title: string;
}
