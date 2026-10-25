import {
  PODCAST_CHARS_PER_MINUTE,
  PODCAST_MAX_CHARS,
  type PodcastFormat,
  type PodcastRequest,
} from "@singularity/core";
import { CUSTOM_BLOCK_CHARS, type ScriptShape } from "./structure.js";

type PodcastLength = PodcastRequest["length_minutes"];

/**
 * The shape of an episode: a hello, teasers for the lead stories, deep dives on the first stories,
 * tight nuggets on the rest, a short close, a sign-off. Stories arrive ranked, so the first ones
 * are the deep dives. Headlines is the legacy shape: an opening, one short turn a story, a sign-off.
 */
export interface EpisodeStructure {
  /** Stories told at length, from the top of the ranking. */
  deep_dives: number;
  /** Stories told in a sentence or two, after the deep dives. */
  nuggets: number;
  /** Lead stories named in the opening rundown. */
  teased: number;
  /** Characters the hello, rundown, close and sign-off take together. */
  frame_chars: number;
  teaser_chars: number;
  close_chars: number;
}

/** Deep dives each length starts from, and the story count at which it earns one more. */
const DEEP_DIVES: Record<PodcastLength, { base: number; extra_from: number }> = {
  3: { base: 0, extra_from: Number.POSITIVE_INFINITY },
  5: { base: 1, extra_from: Number.POSITIVE_INFINITY },
  10: { base: 2, extra_from: 10 },
  15: { base: 3, extra_from: 14 },
};

/** Stories named in the rundown: every story is a clause in a short episode, only the leaders in a long one. */
const TEASED: Record<PodcastLength, number> = { 3: 3, 5: 4, 10: 4, 15: 5 };

/** The close grows with the episode: one sentence at 3 minutes, a few at 15. */
export const CLOSE_CHARS: Record<PodcastLength, number> = { 3: 120, 5: 250, 10: 400, 15: 600 };

/** The hello (one line that names the show) and the sign-off. */
export const HELLO_CHARS = 100;
export const SIGN_OFF_CHARS = 60;
/** One rundown clause: about eight words. */
export const TEASER_CLAUSE_CHARS = 60;
/** The legacy headlines frame, a flat opening and sign-off. */
export const HEADLINES_FRAME_CHARS = 300;

/**
 * Characters a deep dive and a nugget are aimed at, per format. A deep dive says what happened,
 * why it matters and one concrete detail; a nugget is the news in a sentence or two. Headlines
 * has no deep dives.
 */
export const DEEP_DIVE_CHARS: Record<PodcastFormat, number> = {
  readout: 600,
  discussion: 880,
  headlines: 160,
};
export const NUGGET_CHARS: Record<PodcastFormat, number> = {
  readout: 350,
  discussion: 520,
  headlines: 160,
};

/**
 * The most a deep dive or a nugget can carry without padding. A story block is a headline and a
 * summary of a few sentences, so there is only so much to say; past this a writer repeats itself.
 * The deep dive figure was measured on real runs on 2026-10-08.
 */
export const STORY_CAPACITY_CHARS: Record<PodcastFormat, number> = {
  readout: 650,
  discussion: 950,
  // One sentence a story: real headlines ran 137 to 154 characters each, 140 on a thin day.
  headlines: 170,
};
export const NUGGET_CAPACITY_CHARS: Record<PodcastFormat, number> = {
  readout: 450,
  discussion: 650,
  headlines: 170,
};

/** Deep dives an episode of this length and story count gets; a pure function of the two. */
export function deepDiveCount(minutes: PodcastLength, stories: number): number {
  const { base, extra_from } = DEEP_DIVES[minutes];
  return Math.min(Math.max(0, stories), base + (stories >= extra_from ? 1 : 0));
}

/** A long close runs half as long again as the length's own. */
const LONG_CLOSE_SHARE = 1.5;

/**
 * The episode's shape. With a Catch up structure (`shape`, D170) the rundown, the close and the
 * owner blocks follow it and the deep dives are the stories it marks deep, as many as the length
 * has room for; without one it is the shape every episode had before.
 */
export function structureFor(
  minutes: PodcastLength,
  stories: number,
  format: PodcastFormat,
  shape?: ScriptShape | null,
): EpisodeStructure {
  const count = Math.max(0, stories);
  if (format === "headlines") {
    return {
      deep_dives: 0,
      nuggets: count,
      teased: 0,
      frame_chars: HEADLINES_FRAME_CHARS,
      teaser_chars: 0,
      close_chars: 0,
    };
  }
  if (shape) {
    const deep = Math.min(shape.deep.length, deepDiveCount(minutes, count));
    const teased = shape.rundown === false ? 0 : Math.min(count, shape.rundown ?? TEASED[minutes]);
    const teaserChars = teased * TEASER_CLAUSE_CHARS;
    const closeChars =
      shape.close === null
        ? 0
        : Math.round(CLOSE_CHARS[minutes] * (shape.close === "long" ? LONG_CLOSE_SHARE : 1));
    return {
      deep_dives: deep,
      nuggets: count - deep,
      teased,
      frame_chars:
        HELLO_CHARS +
        teaserChars +
        closeChars +
        shape.customs.length * CUSTOM_BLOCK_CHARS +
        SIGN_OFF_CHARS,
      teaser_chars: teaserChars,
      close_chars: closeChars,
    };
  }
  const teased = Math.min(count, TEASED[minutes]);
  const teaserChars = teased * TEASER_CLAUSE_CHARS;
  const closeChars = CLOSE_CHARS[minutes];
  const frame = HELLO_CHARS + teaserChars + closeChars + SIGN_OFF_CHARS;
  // With few stories the usual few deep dives cannot fill the length (a 5 minute readout of seven
  // stories reached 83% of it, aired at 72%): tell more of them at length, as many as it takes.
  const gap = Math.min(minutes * PODCAST_CHARS_PER_MINUTE, PODCAST_MAX_CHARS) - frame;
  const needed = Math.ceil(
    (gap - count * NUGGET_CAPACITY_CHARS[format]) /
      Math.max(1, STORY_CAPACITY_CHARS[format] - NUGGET_CAPACITY_CHARS[format]),
  );
  const deep = Math.min(count, Math.max(deepDiveCount(minutes, count), needed));
  return {
    deep_dives: deep,
    nuggets: count - deep,
    teased,
    frame_chars: frame,
    teaser_chars: teaserChars,
    close_chars: closeChars,
  };
}

/** What the stories of this structure cost at the aimed-at sizes, frame included. */
export function aimedChars(structure: EpisodeStructure, format: PodcastFormat): number {
  return (
    structure.frame_chars +
    structure.deep_dives * DEEP_DIVE_CHARS[format] +
    structure.nuggets * NUGGET_CHARS[format]
  );
}

/** English speech runs about six characters a word, spaces included. */
export const CHARS_PER_WORD = 6;
/** A spoken sentence is about this many words. */
export const WORDS_PER_SENTENCE = 15;

/** Words in so many characters of speech. Models keep to a word count far better than to characters. */
export function wordsFor(chars: number): number {
  return Math.max(1, Math.round(chars / CHARS_PER_WORD));
}

/**
 * The length a script can honestly reach: the budget asked for, or less when the stories given
 * cannot fill it. The writer aims at this and the floor is measured against it, so a thin window
 * gives a shorter true episode instead of three futile rewrites.
 */
export function reachableChars(
  budget: number,
  stories: number,
  format: PodcastFormat,
  minutes: PodcastLength,
  shape?: ScriptShape | null,
): number {
  const structure = structureFor(minutes, Math.max(1, stories), format, shape);
  const capacity =
    structure.deep_dives * STORY_CAPACITY_CHARS[format] +
    structure.nuggets * NUGGET_CAPACITY_CHARS[format];
  return Math.min(budget, structure.frame_chars + capacity);
}

/**
 * The writer is asked to land at about this share of the budget. Models deliver about 88 to 97
 * percent of the length they are asked for, so asking for 95 percent lands a typical reply above
 * the floor and still under the budget, where fitToBudget would drop the last stories.
 */
export const SCRIPT_TARGET_SHARE = 0.95;
/** A reply under this share of the budget is sent back once or twice, then kept if still short. */
export const SCRIPT_FLOOR_SHARE = 0.8;
/**
 * A reply this close under the floor (a share of the floor) is kept instead of rewritten whole:
 * a rewrite costs 25 to 36 seconds and is not reliably longer.
 */
export const SCRIPT_FLOOR_GRACE = 0.05;

/** Characters the writer is asked to reach at least, and the floor below which a reply is sent back. */
export function scriptTargetChars(budget: number): number {
  return Math.floor(budget * SCRIPT_TARGET_SHARE);
}
export function scriptFloorChars(budget: number): number {
  return Math.floor(budget * SCRIPT_FLOOR_SHARE);
}
/** The shortest reply that is kept without a retry: the floor less its grace. */
export function scriptAcceptChars(budget: number): number {
  return Math.floor(scriptFloorChars(budget) * (1 - SCRIPT_FLOOR_GRACE));
}

/** Characters a deep dive and a nugget should carry once the frame is taken out of `budget`. */
export function partChars(
  budget: number,
  stories: number,
  format: PodcastFormat,
  minutes: PodcastLength,
  shape?: ScriptShape | null,
): { deep_dive: number; nugget: number } {
  const structure = structureFor(minutes, Math.max(1, stories), format, shape);
  const aimed = aimedChars(structure, format) - structure.frame_chars;
  const scale = Math.max(0, budget - structure.frame_chars) / Math.max(1, aimed);
  return {
    deep_dive: Math.max(
      1,
      Math.min(STORY_CAPACITY_CHARS[format], Math.floor(DEEP_DIVE_CHARS[format] * scale)),
    ),
    nugget: Math.max(
      1,
      Math.min(NUGGET_CAPACITY_CHARS[format], Math.floor(NUGGET_CHARS[format] * scale)),
    ),
  };
}

export interface PodcastPlan {
  request: PodcastRequest;
  /** Total characters of speech: minutes x 968, never above the hard cap. */
  budget_chars: number;
  /** Most stories the budget can carry in this format. */
  max_stories: number;
}

export function planPodcast(request: PodcastRequest, shape?: ScriptShape | null): PodcastPlan {
  const budget = Math.min(request.length_minutes * PODCAST_CHARS_PER_MINUTE, PODCAST_MAX_CHARS);
  // The frame and the share of deep dives both depend on the count, so find the most that fits.
  let maxStories = 0;
  while (
    aimedChars(
      structureFor(request.length_minutes, maxStories + 1, request.format, shape),
      request.format,
    ) <= budget
  ) {
    maxStories += 1;
  }
  return { request, budget_chars: budget, max_stories: maxStories };
}
