import { PODCAST_CHARS_PER_MINUTE } from "@dispatch/core";

/**
 * Spoken characters per story, its share of the frame (hello, section bridges, sign-off)
 * included: October 2026's seven briefings, 60 stories, 21,850 characters, 364 a story. The
 * writer's 40 to 95 word range keeps a story near this whatever the length.
 */
export const STORY_CHARS = 364;

/**
 * How many stories, in every section together, fill a briefing of this many minutes at the
 * narration's measured pace. Never fewer than the floor below which nothing publishes, never more
 * than the digest's hard cap.
 */
export function storiesForMinutes(minutes: number, floor: number, hardMax: number): number {
  const stories = Math.round((minutes * PODCAST_CHARS_PER_MINUTE) / STORY_CHARS);
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
 * weekly sizes about 40 stories, and 40 tellings near the 700-character ceiling run past the
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
 * survivors up to the length and leaves the rest unaired.
 */
export const SPARE_SHARE = 0.3;

/** The stories to select and write for a briefing of `wanted` stories, spares included. */
export function withSpares(wanted: number, hardMax: number): number {
  return Math.min(hardMax, wanted + Math.ceil(wanted * SPARE_SHARE));
}

/** Narration characters a briefing of this many minutes holds at the measured pace. */
export function charsForMinutes(minutes: number): number {
  return Math.round(minutes * PODCAST_CHARS_PER_MINUTE);
}

/**
 * The ids to leave out so the briefing's narration fills `lengthChars`, measured from what was
 * written rather than the 364-character average: Sonnet tells a story longer than Nebius did, and a
 * five-minute replay ran 5.7 minutes on the average alone. Stories are cut in the reverse of how
 * selection fills a briefing: the lowest-scored story of a topic that has another goes first, so
 * every topic keeps its best story; only then the lowest-scored overall. A cut is made only while
 * the rest still fills the length, so the briefing ends at most one story over it, never short.
 */
export function sparesOverLength(
  stories: readonly { id: string; category: string; score: number; chars: number }[],
  lengthChars: number,
  floor = 1,
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
    if (airtime() - next.chars - STORY_FRAME_CHARS < lengthChars) break;
    left.splice(index, 1);
    cut.push(next.id);
  }
  return cut;
}

/** The narration a written story costs: its spoken telling, or the headline and summary it falls back to. */
export function toldChars(text: { headline: string; summary: string; spoken?: string }): number {
  return (text.spoken ?? `${text.headline} ${text.summary}`).length;
}
