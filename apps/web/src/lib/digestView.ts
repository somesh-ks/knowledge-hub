import { type DigestItem, digestSections } from "@dispatch/core";
import { briefingLengthLabel, storyLengthLabel } from "../player/core/readerMath";
import type { DigestEntry } from "./digests";
import { formatClock, pluralize } from "./format";
import { sectionLabel } from "./sectionLabel";

export { sectionLabel };

export interface ItemView {
  item: DigestItem;
  /** Reading-order index, the same number the player uses. */
  index: number;
  /** The story's share of the recording as "m:ss", or "" while there is no audio to play. */
  length: string;
}

export interface SectionView {
  slug: string;
  title: string;
  items: ItemView[];
  /** Index of the section's first item. */
  firstIndex: number;
  /** Section length as "m:ss", or null while there is no audio to play. */
  clock: string | null;
}

export function buildSections(entry: DigestEntry): SectionView[] {
  const hasAudio = entry.audioMode === "ready";
  const timed = new Map(entry.timeline?.items.map((item) => [item.id, item]));
  const sectionStarts = new Map(entry.timeline?.sections.map((section) => [section.slug, section]));
  const views: SectionView[] = [];
  for (const { id: slug, title } of digestSections(entry.digest)) {
    const items = entry.items
      .map((item, index) => {
        const marks = hasAudio ? timed.get(item.id) : undefined;
        // The same function the player labels a chip with, so the two never disagree.
        const length = storyLengthLabel(marks?.start_ms ?? null, marks?.end_ms ?? null);
        return { item, index, length };
      })
      .filter(({ item }) => item.section === slug);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) continue;
    const start = sectionStarts.get(slug)?.start_ms ?? timed.get(first.item.id)?.start_ms;
    const end = timed.get(last.item.id)?.end_ms;
    views.push({
      slug,
      title: sectionLabel(title),
      items,
      firstIndex: first.index,
      clock: hasAudio && start !== undefined && end !== undefined ? formatClock(end - start) : null,
    });
  }
  return views;
}

export interface HeroView {
  title: string;
  /**
   * The parts of the line beside the play chip: "12 stories", after "Weekly" on a weekly, as its
   * Library card says. The length is the chip's own label.
   */
  meta: string[];
  /** The play chip's label before anything plays: "4 min". */
  length: string;
}

/**
 * "8 min": how long the briefing takes to hear. The recording's own length once it exists; until
 * then, the estimate written with the text.
 */
export function listenLength(entry: DigestEntry): string {
  const { digest } = entry;
  return entry.audioMode === "ready" && digest.audio
    ? briefingLengthLabel(digest.audio.duration_ms)
    : `${digest.listen_minutes} min`;
}

export function buildHero(entry: DigestEntry, title: string): HeroView {
  const { digest } = entry;
  const length = listenLength(entry);
  return {
    title,
    meta: [...(digest.kind === "weekly" ? ["Weekly"] : []), storyCount(digest.items.length)],
    length,
  };
}

/** "12 stories". Reader-facing copy never says "items". */
export function storyCount(count: number): string {
  return pluralize(count, "story", "stories");
}

/**
 * Why the briefing cannot be played, shown under its play chip. Audio not made yet says nothing:
 * the chip makes it on press. Only audio that was there and is gone is worth a line.
 */
export const AUDIO_UNAVAILABLE_COPY = {
  // Said once, plainly: the chip's preparing state shows that pressing it makes the audio again.
  expired: { label: "The audio has expired." },
} as const;

/** Whether a briefing draws section tabs and the contents column: two sections or more. */
export function hasSectionTabs(entry: DigestEntry): boolean {
  return digestSections(entry.digest).length > 1;
}
