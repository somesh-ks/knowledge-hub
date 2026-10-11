import type { PlayerDigestData } from "../../types/contracts";
import type { Timeline } from "./timeline";

export interface StoryEntry {
  id: string;
  index: number;
  headline: string;
  section: string;
  durationSec: number | null;
}

export interface StorySection {
  slug: string;
  title: string;
}

export interface StoryEntries {
  /** True when every row has a place on the timeline, so a row can play its story. */
  timed: boolean;
  items: StoryEntry[];
  sections: StorySection[];
}

/**
 * The rows of the Chapters list. From the timeline when it has stories on it; otherwise from the
 * digest's own items, which have no place in the audio yet (an episode whose narration has not been
 * laid out), so they are listed but cannot be played from. A timeline with no stories on it is not
 * a reason to show an empty list while the digest has items.
 */
export function storyEntries(
  timeline: Timeline | null | undefined,
  digest: PlayerDigestData | null | undefined,
): StoryEntries {
  if (timeline && timeline.items.length > 0) {
    return {
      timed: true,
      items: timeline.items.map((item) => ({
        id: item.id,
        index: item.index,
        headline: item.headline,
        section: item.section,
        durationSec: Math.max(0, item.endSec - item.startSec),
      })),
      sections: timeline.sections.map((section) => ({ slug: section.slug, title: section.title })),
    };
  }
  const items = (digest?.items ?? []).map((item, index) => ({
    id: item.id,
    index,
    headline: item.headline,
    section: item.section,
    durationSec:
      item.start_ms !== null && item.end_ms !== null
        ? Math.max(0, (item.end_ms - item.start_ms) / 1000)
        : null,
  }));
  const known = new Set(items.map((item) => item.section));
  const sections =
    digest?.sections && digest.sections.length > 0
      ? digest.sections.map((section) => ({ slug: section.slug, title: section.title }))
      : [];
  // Items in a section the digest does not name still show, under one plain heading.
  const named = new Set(sections.map((section) => section.slug));
  const orphans = [...known].filter((slug) => !named.has(slug));
  for (const slug of orphans) sections.push({ slug, title: "Stories" });
  return { timed: false, items, sections };
}
