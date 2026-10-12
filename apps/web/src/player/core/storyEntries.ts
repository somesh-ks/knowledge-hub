import type { PlayerDigestData, PlayerTurn } from "../../types/contracts";
import type { Timeline } from "./timeline";

export interface StoryEntry {
  id: string;
  index: number;
  headline: string;
  section: string;
  durationSec: number | null;
  /**
   * Where the story starts, in seconds: on the timeline, or estimated from an episode's script
   * before its narration is laid out. Null when nothing places it, and then a row cannot play it.
   */
  startSec: number | null;
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
 * The narration's own estimate of its pace before a segment is narrated, in milliseconds a character
 * (MS_PER_CHARACTER in server/config.ts, FALLBACK_MS_PER_CHARACTER in narrationController.ts).
 */
export const ESTIMATE_MS_PER_CHARACTER = 62;
/** As in narrationPlan.ts: no turn is shorter than this, so a story never collapses to nothing. */
const MIN_TURN_MS = 500;

/**
 * Where each story of an episode is said, from its turns: a story starts at the first turn about it
 * and ends with the last. A turn that has been laid out on the narration keeps its real place; one
 * that has not is given the length its characters take at the narration's pace.
 */
export function turnStorySpans(
  turns: readonly Pick<PlayerTurn, "text" | "item_id" | "start_ms" | "end_ms">[],
  msPerCharacter = ESTIMATE_MS_PER_CHARACTER,
): Map<string, { start_ms: number; end_ms: number }> {
  const spans = new Map<string, { start_ms: number; end_ms: number }>();
  let cursor = 0;
  for (const turn of turns) {
    const placed = turn.start_ms !== null && turn.end_ms !== null && turn.end_ms >= turn.start_ms;
    const start = placed ? (turn.start_ms ?? cursor) : cursor;
    const end = placed
      ? (turn.end_ms ?? start)
      : start + Math.max(MIN_TURN_MS, Math.round(turn.text.length * msPerCharacter));
    cursor = end;
    const id = typeof turn.item_id === "string" ? turn.item_id : null;
    if (id === null) continue;
    const earlier = spans.get(id);
    spans.set(id, { start_ms: earlier?.start_ms ?? start, end_ms: end });
  }
  return spans;
}

/**
 * The rows of the Chapters list. From the timeline when it has stories on it; otherwise from the
 * digest's own items, which have no place in the audio yet (an episode whose narration has not been
 * laid out). An episode's items are then placed by its script, so a row can still start its story;
 * a briefing's are listed but cannot be played from. A timeline with no stories on it is not a
 * reason to show an empty list while the digest has items.
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
        startSec: item.startSec,
      })),
      sections: timeline.sections.map((section) => ({ slug: section.slug, title: section.title })),
    };
  }
  const spans = digest?.turns ? turnStorySpans(digest.turns) : null;
  const items = (digest?.items ?? []).map((item, index) => {
    const span =
      item.start_ms !== null && item.end_ms !== null
        ? { start_ms: item.start_ms, end_ms: item.end_ms }
        : (spans?.get(item.id) ?? null);
    return {
      id: item.id,
      index,
      headline: item.headline,
      section: item.section,
      durationSec: span ? Math.max(0, (span.end_ms - span.start_ms) / 1000) : null,
      startSec: spans && span ? span.start_ms / 1000 : null,
    };
  });
  // In the order they are said, when the script places them; a story it never reaches goes last.
  if (spans) {
    items.sort(
      (a, b) =>
        (a.startSec ?? Number.POSITIVE_INFINITY) - (b.startSec ?? Number.POSITIVE_INFINITY) ||
        a.index - b.index,
    );
  }
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

/**
 * The story to go to from `seconds` by Previous (-1) or Next (+1), among stories placed by an
 * estimate: Previous goes to the start of the story being heard, Next to the one after it. Null
 * when there is none that way: before the first story (the rundown) Previous has no story behind it.
 */
export function steppedStory(
  entries: readonly StoryEntry[],
  seconds: number,
  direction: -1 | 1,
): StoryEntry | null {
  const placed = entries.filter((entry) => entry.startSec !== null);
  let at = -1;
  for (const [index, entry] of placed.entries()) {
    if ((entry.startSec ?? 0) <= seconds) at = index;
  }
  const target = direction === 1 ? at + 1 : at;
  return placed[target] ?? null;
}
