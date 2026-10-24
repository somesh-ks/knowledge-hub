import type { DigestKind, ScheduleFile } from "@dispatch/core";
import type { RunMode } from "../gate/decideRun.js";

/**
 * Spoken characters per story, its share of the frame (hello, section bridges, sign-off)
 * included: October 2026's seven briefings, 60 stories, 21,850 characters, 364 a story. The
 * writer's 40 to 95 word range keeps a story near this whatever the length.
 */
export const STORY_CHARS = 364;

/**
 * Narration characters in a minute of a briefing: the four briefings narrated 2026-10-18 to
 * 10-24 ran 1,057 to 1,073 (`text_chars` over `duration_ms` in their `.audio.json`). Sized at
 * the podcast's 968, a full five-minute briefing aired about 4.5 minutes.
 */
export const BRIEFING_CHARS_PER_MINUTE = 1066;

/**
 * How many stories, in every section together, fill a briefing of this many minutes at the
 * narration's measured pace. Never fewer than the floor below which nothing publishes, never more
 * than the digest's hard cap.
 */
export function storiesForMinutes(minutes: number, floor: number, hardMax: number): number {
  const stories = Math.round((minutes * BRIEFING_CHARS_PER_MINUTE) / STORY_CHARS);
  return Math.max(floor, Math.min(hardMax, stories));
}

/**
 * Narration characters a story costs beyond its own telling (a connective or a section bridge),
 * and the episode beyond its stories (the hello and the sign-off). Measured generously from
 * `buildSpokenText`, so an episode that fits here fits the narration request.
 */
export const STORY_FRAME_CHARS = 60;
export const EPISODE_FRAME_CHARS = 600;

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
 * survivors up to the length and leaves the rest unaired. Writing, grounding and validation lose
 * about 45% of what selection chose (2026-10-09: 6 of 15 written; the 2026-10-18 weekly: 13 of 27
 * selected), so a 0.3 share left the 15-minute weekly at 14 stories and 5 minutes. Covering a
 * 45% loss takes a share of at least 0.82.
 */
export const SPARE_SHARE = 0.85;

/**
 * Stories a length-sized briefing may select and write, spares included. Above the digest's hard
 * maximum (48), which holds what airs: a 15-minute weekly wants 44 stories and writes 80.
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
 * own allowances) and filled 27 of its 52 slots.
 */
export const CANDIDATES_PER_STORY = 2.4;

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
): number | null {
  if (kind === "weekly") return schedule.weekly.length_minutes;
  if (kind === "regular" && mode === "scheduled") return schedule.length_minutes;
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
    const perTopic = new Map<string, number>();
    for (const story of left) perTopic.set(story.category, (perTopic.get(story.category) ?? 0) + 1);
    const index = Math.max(
      0,
      left.findIndex((story) => (perTopic.get(story.category) ?? 0) > 1),
    );
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

/** The narration a written story costs: its spoken telling, or the headline and summary it falls back to. */
export function toldChars(text: { headline: string; summary: string; spoken?: string }): number {
  return (text.spoken ?? `${text.headline} ${text.summary}`).length;
}
