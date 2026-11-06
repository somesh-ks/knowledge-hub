import {
  BRIEFING_CHARS_PER_MINUTE,
  type DigestKind,
  EPISODE_FRAME_CHARS,
  type ScheduleFile,
  STORY_FRAME_CHARS,
} from "@singularity/core";
import type { RunMode } from "../gate/decideRun.js";

// The pace and a story's share of it moved to core (storyCount.ts), where the Stories control reads
// them too (D377).
export {
  BRIEFING_CHARS_PER_MINUTE,
  EPISODE_FRAME_CHARS,
  STORY_CHARS,
  STORY_FRAME_CHARS,
  storiesForMinutes,
} from "@singularity/core";

/**
 * The stories that fit one narration request, best first until the next would not fit. A 15-minute
 * weekly sizes about 44 stories, and 40 tellings near the 700-character ceiling run past the
 * 19,000 characters one request takes, which fails the episode's whole audio. Returns the ids to
 * drop, lowest score first.
 */
export function overNarrationLimit(
  stories: readonly { id: string; score: number; chars: number }[],
  limit: number,
): string[] {
  let used = EPISODE_FRAME_CHARS;
  const over: string[] = [];
  for (const story of [...stories].sort((a, b) => b.score - a.score)) {
    const cost = story.chars + STORY_FRAME_CHARS;
    if (used + cost > limit) over.push(story.id);
    else used += cost;
  }
  return over;
}

/**
 * Extra stories, as a share of the length's stories, that a length-sized briefing selects and
 * writes beyond what it airs. Every story the writer, the voice check or grounding drops after
 * selection used to come off the owner's length: the 2026-10-15 daily chose 14 stories for five
 * minutes and published 4 (4 not written, 6 dropped by grounding). Validation keeps the best
 * survivors up to the length and leaves the rest unaired. 0.85 covered October's 45%. The dailies
 * in state/run-metrics.json on 2026-11-06 wrote 54% to 100% of the 28 they chose (most of the loss
 * at the writer), then validation dropped 2 to 4, and aired 12 or 13: the rest were spares paid for
 * in writer and grounding calls and about 40 s of a regenerate. 0.6 fills the length on the first
 * pass in four of those five runs; a shortfall past it is refilled from the reserve once
 * (validateStage). D119, revisited.
 */
export const SPARE_SHARE = 0.6;

/**
 * Stories a length-sized briefing may select and write, spares included. Above the digest's hard
 * maximum (48), which holds what airs: a 15-minute weekly wants 44 stories and writes 71.
 */
export const WRITE_MAX = 80;

/** The stories to select and write for a briefing of `wanted` stories, spares included. */
export function withSpares(wanted: number, most = WRITE_MAX): number {
  return Math.min(most, wanted + Math.ceil(wanted * SPARE_SHARE));
}

/**
 * Candidates the prefilter sends to the judge per story a sized briefing writes: its fixed 60 for a
 * five-minute daily's 25. The pool was 60 whatever the length, so the 15-minute weekly of
 * 2026-10-18 had 99 qualifying stories (most of them general news and release notes held to their
 * own allowances) and filled 27 of its 52 slots. 2.8 since the spare share fell to 0.6, so the judge
 * sees as many candidates as it did at 2.4 with 0.85.
 */
export const CANDIDATES_PER_STORY = 2.8;

/** The prefilter's main cap for a briefing that writes `written` stories; never below `floor`. */
export function poolCapFor(written: number, floor: number): number {
  return Math.max(floor, Math.ceil(written * CANDIDATES_PER_STORY));
}

/**
 * Minutes that size a pass: the weekly podcast's length for the weekly pass in any mode, the daily
 * podcast's for a scheduled regular briefing, none otherwise.
 */
export function lengthMinutesFor(
  schedule: Pick<ScheduleFile, "length_minutes" | "weekly">,
  kind: DigestKind,
  mode: RunMode,
  /** The length the person asked this run for (a Regenerate's Length); it beats the schedule's. */
  asked?: number,
): number | null {
  if (asked !== undefined) return asked;
  if (kind === "weekly") return schedule.weekly.length_minutes;
  if (kind === "regular" && mode === "scheduled") return schedule.length_minutes;
  return null;
}

/**
 * The story count a person picked for a pass (D377): this run's own (a Regenerate's Stories), else
 * the weekly podcast's for the weekly pass, the daily podcast's for a scheduled regular briefing.
 * Null is Auto: the length sizes the count.
 */
export function storiesPickedFor(
  schedule: Pick<ScheduleFile, "stories" | "weekly">,
  kind: DigestKind,
  mode: RunMode,
  asked?: number | null,
): number | null {
  if (asked !== undefined) return asked;
  if (kind === "weekly") return schedule.weekly.stories ?? null;
  if (kind === "regular" && mode === "scheduled") return schedule.stories ?? null;
  return null;
}

/** Narration characters a briefing of this many minutes holds at the measured pace. */
export function charsForMinutes(minutes: number): number {
  return Math.round(minutes * BRIEFING_CHARS_PER_MINUTE);
}

/**
 * The ids to leave out so the briefing's narration fills `lengthChars`, measured from what was
 * written rather than the 364-character average: Sonnet tells a longer story than the earlier models did, and a
 * five-minute replay ran 5.7 minutes on the average alone. Stories are cut in the reverse of how
 * selection fills a briefing: the lowest-scored story of a topic that has another goes first, so
 * every topic keeps its best story; only then the lowest-scored overall. A cut is made only while
 * the rest still fills the length, so the briefing ends at most one story over it, never short.
 */
export function sparesOverLength(
  stories: readonly { id: string; category: string; score: number; chars: number }[],
  lengthChars: number,
  floor = 1,
  /**
   * The narration's real length for these stories, when the caller can build it. The estimate
   * below over-counts the host's frame by 730 to 1,340 characters an episode (2026-10 episodes:
   * 7 to 47 characters a story, not 60), so it cut a story the length still had room for: the
   * 2026-10-17 daily aired 10 of 11 at 3.7 of its 5 minutes.
   */
  measure?: (ids: ReadonlySet<string>) => number,
): string[] {
  const left = [...stories].sort((a, b) => a.score - b.score);
  const airtime = (): number =>
    left.reduce((sum, story) => sum + story.chars + STORY_FRAME_CHARS, EPISODE_FRAME_CHARS);
  const cut: string[] = [];
  while (left.length > floor) {
    const index = nextCut(left);
    const next = left[index] as { id: string; chars: number };
    const without = measure
      ? measure(new Set(left.filter((story) => story !== next).map((story) => story.id)))
      : airtime() - next.chars - STORY_FRAME_CHARS;
    if (without < lengthChars) break;
    left.splice(index, 1);
    cut.push(next.id);
  }
  return cut;
}

/**
 * The ids to leave out so the briefing airs the `count` stories the owner picked (D377), cut in the
 * order `sparesOverLength` cuts: a topic's lowest-scored story while the topic has another, then
 * the lowest-scored overall.
 */
export function sparesOverCount(
  stories: readonly { id: string; category: string; score: number }[],
  count: number,
): string[] {
  const left = [...stories].sort((a, b) => a.score - b.score);
  const cut: string[] = [];
  while (left.length > count) {
    const [next] = left.splice(nextCut(left), 1);
    if (next) cut.push(next.id);
  }
  return cut;
}

/** Where the next cut falls in stories sorted lowest score first: see `sparesOverLength`. */
function nextCut(left: readonly { category: string }[]): number {
  const perTopic = new Map<string, number>();
  for (const story of left) perTopic.set(story.category, (perTopic.get(story.category) ?? 0) + 1);
  return Math.max(
    0,
    left.findIndex((story) => (perTopic.get(story.category) ?? 0) > 1),
  );
}

/** The narration a written story costs: its spoken telling, or the headline and summary it falls back to. */
export function toldChars(text: { headline: string; summary: string; spoken?: string }): number {
  return (text.spoken ?? `${text.headline} ${text.summary}`).length;
}
