import type { PlayerDigestData, PlayerItem, PlayerSection } from "../../types/contracts";
import { isFiniteNumber } from "./mathUtils";

export interface TimelineItem {
  id: string;
  index: number;
  startSec: number;
  endSec: number;
  headline: string;
  source: string;
  /** The story's source page, or null when the digest has none that is safe to link. */
  url: string | null;
  section: PlayerItem["section"];
}

export interface TimelineSection {
  slug: PlayerSection["slug"];
  title: string;
  startSec: number;
  endSec: number;
  /** Index into `items` of the first item in this section. */
  firstIndex: number;
}

export interface Timeline {
  durationSec: number;
  items: readonly TimelineItem[];
  sections: readonly TimelineSection[];
}

/**
 * Turns the digest's millisecond marks into seconds the player can seek with. Returns null for a
 * digest without audio. Items without marks are dropped rather than guessed: a wrong seek is worse
 * than a missing tick, and the rest of the player still works on the overall duration.
 */
export function buildTimeline(digest: PlayerDigestData): Timeline | null {
  if (!digest.audio) return null;
  const durationSec = Math.max(0, digest.audio.duration_ms / 1000);
  const marked = digest.items
    .filter((item) => isFiniteNumber(item.start_ms))
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));

  const items: TimelineItem[] = marked.map((item, index) => {
    const next = marked[index + 1];
    const startSec = Math.min(durationSec, (item.start_ms ?? 0) / 1000);
    const endMs = isFiniteNumber(item.end_ms) ? item.end_ms : (next?.start_ms ?? null);
    const endSec = endMs === null ? durationSec : Math.min(durationSec, endMs / 1000);
    return {
      id: item.id,
      index,
      startSec,
      // A zero-length item would divide by zero in the rail's interpolation.
      endSec: Math.max(endSec, startSec),
      headline: item.headline,
      source: item.source,
      url: item.url ?? null,
      section: item.section,
    };
  });

  const sections: TimelineSection[] = [];
  for (const section of digest.sections) {
    const firstIndex = items.findIndex((item) => item.section === section.slug);
    if (firstIndex === -1) continue;
    const first = items[firstIndex];
    if (!first) continue;
    sections.push({
      slug: section.slug,
      title: section.title,
      startSec: first.startSec,
      endSec: durationSec,
      firstIndex,
    });
  }
  sections.sort((a, b) => a.startSec - b.startSec);
  const closed = sections.map((section, index) => ({
    ...section,
    endSec: sections[index + 1]?.startSec ?? durationSec,
  }));

  return { durationSec, items, sections: closed };
}

/**
 * Index of the last item that starts at or before `seconds`, or -1 in any lead-in before the first
 * story (an episode's rundown), which belongs to no story.
 */
export function itemIndexAt(timeline: Timeline | null, seconds: number): number {
  const items = timeline?.items;
  if (!items || items.length === 0) return 0;
  if (seconds < (items[0]?.startSec ?? 0)) return -1;
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((items[middle]?.startSec ?? 0) <= seconds) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function sectionIndexOfItem(timeline: Timeline | null, itemIndex: number): number {
  const item = timeline?.items[itemIndex];
  if (!timeline || !item) return 0;
  const found = timeline.sections.findIndex((section) => section.slug === item.section);
  return Math.max(0, found);
}

/** 0 to 1 position of `seconds` inside an item. Used by the rail to fill between nodes. */
export function fractionWithinItem(item: TimelineItem, seconds: number): number {
  const length = item.endSec - item.startSec;
  if (length <= 0) return seconds >= item.startSec ? 1 : 0;
  return Math.min(1, Math.max(0, (seconds - item.startSec) / length));
}

export function findItemIndexById(timeline: Timeline | null, id: string): number {
  return timeline?.items.findIndex((item) => item.id === id) ?? -1;
}

/** Item numbering is for people: "Item 5 of 12". */
export function itemPositionLabel(timeline: Timeline | null, index: number): string {
  const total = timeline?.items.length ?? 0;
  return total === 0 || index < 0 || index >= total ? "" : `Story ${index + 1} of ${total}`;
}

/**
 * The section a story's position is told with: a briefing's own section ("Design engineering"),
 * and none for an episode, whose one section is a placeholder that says nothing.
 */
export function storySectionName(
  digest: Pick<PlayerDigestData, "kind" | "turns"> | undefined,
  section: Pick<TimelineSection, "title"> | undefined,
): string {
  if (!digest || !section || digest.kind === "on-demand" || digest.turns) return "";
  return section.title;
}

/** The bar's caption for a story: "Story 6 of 12 · Design engineering", or "Story 1 of 6". */
export function storyCaption(
  timeline: Timeline | null,
  index: number,
  sectionName: string,
): string {
  const position = itemPositionLabel(timeline, index);
  return sectionName ? `${position} · ${sectionName}` : position;
}
