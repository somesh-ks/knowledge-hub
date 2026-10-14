import type { Digest } from "@dispatch/core";
import { buildSpokenText, itemBlock, type SpokenText } from "./spokenText.js";

/**
 * The narration cut into stretches that can each be synthesized and played on their own, so the
 * first one is audible long before the whole digest could be.
 *
 * Nothing here writes spoken text. Every segment is a slice of what `buildSpokenText` returns, cut
 * at the item ranges and section starts it reports, so the segments and the whole narration cannot
 * disagree: put back together with the separator between them, they are the full text.
 */

export const INTRO_KEY = "intro";
export const OUTRO_KEY = "outro";

export interface SpokenSegment {
  /** "intro" for the opening, the item id for a story, "outro" for a closing line. */
  key: string;
  /** The story this segment reads, or null for the intro and the outro. */
  itemId: string | null;
  text: string;
}

/**
 * Cuts spoken text into segments, in the order they are spoken.
 *
 * A story's segment starts at its own text, except for the first story of a section, which starts
 * at the section's announcement: the announcement is heard as the lead-in to that story. Text
 * before the first story is the intro, and text after the last one, if there is any, is the outro.
 * Every other character belongs to the story it follows, so no text is ever dropped. The white
 * space between segments is the separator and belongs to none of them.
 */
export function segmentSpokenText(spoken: SpokenText): SpokenSegment[] {
  const { text } = spoken;
  const ranges = [...spoken.ranges].sort((a, b) => a.start - b.start);

  const starts: number[] = [];
  const announced = new Set<string>();
  let previousEnd = 0;
  for (const range of ranges) {
    let start = range.start;
    if (!announced.has(range.section)) {
      announced.add(range.section);
      const announcement = spoken.sectionStarts.find((section) => section.slug === range.section);
      // An announcement only leads into this story when it sits between the previous one and it.
      if (announcement && announcement.start >= previousEnd && announcement.start <= range.start) {
        start = announcement.start;
      }
    }
    starts.push(start);
    previousEnd = range.end;
  }

  const segments: SpokenSegment[] = [];
  const add = (key: string, itemId: string | null, from: number, to: number): void => {
    const slice = text.slice(from, to).trim();
    if (slice.length > 0) segments.push({ key, itemId, text: slice });
  };

  add(INTRO_KEY, null, 0, starts[0] ?? text.length);
  ranges.forEach((range, index) => {
    add(range.id, range.id, starts[index] ?? range.start, starts[index + 1] ?? range.end);
  });
  const last = ranges.at(-1);
  if (last) add(OUTRO_KEY, null, last.end, text.length);
  return segments;
}

/**
 * How many words the host says in a story's segment before the story's own block: the section
 * announcement and the link between stories. Counted as word marks count them (white-space
 * pieces), by story id; a story that starts its segment is absent.
 */
export function leadInWords(digest: Digest): Map<string, number> {
  const lead = new Map<string, number>();
  const items = new Map(digest.items.map((item) => [item.id, item]));
  for (const segment of spokenSegments(digest)) {
    const item = segment.itemId === null ? undefined : items.get(segment.itemId);
    if (!item) continue;
    const before = segment.text.slice(0, segment.text.length - itemBlock(item).length);
    const count = before.match(/\S+/g)?.length ?? 0;
    if (count > 0) lead.set(item.id, count);
  }
  return lead;
}

/** The segments of a digest's narration: the intro, one per story, and an outro if there is one. */
export function spokenSegments(digest: Digest): SpokenSegment[] {
  return segmentSpokenText(buildSpokenText(digest));
}
