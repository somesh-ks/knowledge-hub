import { VOICE_LIMITS } from "./voiceLimits.js";

/**
 * Story-count arithmetic, free of zod so the browser's Stories controls can load it
 * (`@singularity/core/storyCount`).
 */

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
 * Narration characters a story costs beyond its own telling (a connective or a section bridge),
 * and the episode beyond its stories (the hello and the sign-off). Measured generously from
 * `buildSpokenText`, so an episode that fits here fits the narration request.
 */
export const STORY_FRAME_CHARS = 60;
export const EPISODE_FRAME_CHARS = 600;

/**
 * How many stories, in every section together, fill a briefing of this many minutes at the
 * narration's measured pace. Never fewer than the floor below which nothing publishes, never more
 * than the digest's hard cap.
 */
export function storiesForMinutes(minutes: number, floor: number, hardMax: number): number {
  const stories = Math.round((minutes * BRIEFING_CHARS_PER_MINUTE) / STORY_CHARS);
  return Math.max(floor, Math.min(hardMax, stories));
}

/** The numbers the Stories control offers beside Auto, before those a length cannot hold are left out. */
export const STORY_COUNTS = [5, 8, 10, 12, 15, 20, 25, 30, 40] as const;

/**
 * English speech runs about six characters a word, spaces included: 364 characters a story is about
 * 60 words. One value for the Stories control and the episode planner (podcast/plan.ts).
 */
export const CHARS_PER_WORD = 6;

/**
 * The shortest telling a picked count may squeeze a story to: about 20 words, one fact and why it
 * matters. Fewer words stop being a story, so a length holds no more stories than this allows.
 */
export const MIN_TELLING_WORDS = 20;

/** The stories a length holds at Auto: the usual telling, as `storiesForMinutes` sizes it. */
export function autoStories(minutes: number): number {
  return storiesForMinutes(minutes, VOICE_LIMITS.items.floor, VOICE_LIMITS.items.hardMax);
}

/** The most stories a length holds, each told in `MIN_TELLING_WORDS`. */
export function mostStories(minutes: number): number {
  const room = minutes * BRIEFING_CHARS_PER_MINUTE - EPISODE_FRAME_CHARS;
  const story = MIN_TELLING_WORDS * CHARS_PER_WORD + STORY_FRAME_CHARS;
  return Math.max(
    VOICE_LIMITS.items.floor,
    Math.min(VOICE_LIMITS.items.hardMax, Math.floor(room / story)),
  );
}

/** The numbers the Stories control offers for a length: those it can hold. */
export function storyChoices(minutes: number): number[] {
  const most = mostStories(minutes);
  return STORY_COUNTS.filter((count) => count <= most);
}

/** The count an episode of this length airs: the picked one, held to what the length can hold. */
export function storiesFor(minutes: number, picked: number | null | undefined): number {
  return picked == null ? autoStories(minutes) : Math.min(picked, mostStories(minutes));
}

/**
 * The words each spoken telling aims at so `count` stories fit `minutes`: null when the usual
 * telling fits (no more stories than Auto), otherwise the share of the length a story has, never
 * under `MIN_TELLING_WORDS`.
 */
export function tellingWords(minutes: number, count: number): number | null {
  if (count <= autoStories(minutes)) return null;
  const room = minutes * BRIEFING_CHARS_PER_MINUTE - EPISODE_FRAME_CHARS;
  const share = room / count - STORY_FRAME_CHARS;
  return Math.max(MIN_TELLING_WORDS, Math.round(share / CHARS_PER_WORD));
}
