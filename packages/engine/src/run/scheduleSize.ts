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
