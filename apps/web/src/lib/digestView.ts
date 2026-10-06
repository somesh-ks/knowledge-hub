import { type DigestItem, SECTION_TITLES, SECTIONS, type Section } from "@dispatch/core";
import type { DigestEntry } from "./digests";
import { formatClock, pluralize, sinceLabel } from "./format";

export interface ItemView {
  item: DigestItem;
  /** Reading-order index, the same number the player uses. */
  index: number;
  isLead: boolean;
}

export interface SectionView {
  slug: Section;
  title: string;
  items: ItemView[];
  /** Index of the section's first item, for the chapter button. */
  firstIndex: number;
  /** Section length as "m:ss", or null while there is no timeline. */
  clock: string | null;
}

export function buildSections(entry: DigestEntry): SectionView[] {
  const timed = new Map(entry.timeline?.items.map((item) => [item.id, item]));
  const sectionStarts = new Map(entry.timeline?.sections.map((section) => [section.slug, section]));
  const views: SectionView[] = [];
  for (const slug of SECTIONS) {
    const items = entry.items
      .map((item, index) => ({ item, index, isLead: index === 0 }))
      .filter(({ item }) => item.section === slug);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) continue;
    const start = sectionStarts.get(slug)?.start_ms ?? timed.get(first.item.id)?.start_ms;
    const end = timed.get(last.item.id)?.end_ms;
    views.push({
      slug,
      title: SECTION_TITLES[slug],
      items,
      firstIndex: first.index,
      clock:
        entry.audioMode === "ready" && start !== undefined && end !== undefined
          ? formatClock(end - start)
          : null,
    });
  }
  return views;
}

export interface HeroView {
  title: string;
  /** "12 items since Monday" */
  countLine: string;
  /** "2 min to read, 4 to listen" */
  timeLine: string;
  /** "3:32", or null while there is no audio. */
  clock: string | null;
}

export function buildHero(entry: DigestEntry, title: string): HeroView {
  const { digest } = entry;
  const count = pluralize(digest.items.length, "item");
  const since = sinceLabel(digest.window.from, digest.date);
  return {
    title,
    countLine: since === "today" ? `${count} today` : `${count} ${since}`,
    timeLine: `${digest.read_minutes} min to read, ${digest.listen_minutes} to listen`,
    clock:
      entry.audioMode === "ready" && digest.audio ? formatClock(digest.audio.duration_ms) : null,
  };
}

/** Copy for the call-to-action when the briefing cannot be played yet or any more. */
export const AUDIO_UNAVAILABLE_COPY = {
  preparing: {
    label: "Audio is still being prepared",
    hint: "Narration is generated after the text. It usually takes a few minutes.",
  },
  expired: {
    label: "The audio has expired",
    hint: "Audio is kept for about four months. The text and its chapters stay.",
  },
} as const;
