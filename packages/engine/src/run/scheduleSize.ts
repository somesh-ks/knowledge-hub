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
