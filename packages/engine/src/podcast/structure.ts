import {
  RELEASE_NEWS_SECTION,
  type StructureBlock,
  TOP_PICKS_SECTION,
  TRENDING_BLOCK_SECTION,
} from "@singularity/core";
import { RELEASE_CATEGORY } from "../score/releaseNotes.js";
import { outletOf } from "../score/selectItems.js";
import type { PodcastStory } from "./types.js";

/**
 * What the stored Catch up structure (D170) asks of one script. Absent means the shape every
 * episode had before the structure existed: the planner and the prompt then run unchanged.
 */
export interface ScriptShape {
  /** Stories the rundown names, null for the length's own count, or false for no rundown. */
  rundown: number | null | false;
  close: "short" | "long" | null;
  /** Owner blocks, each said just before the story at `before` (stories.length: after the last). */
  customs: readonly { title: string; brief: string; before: number }[];
  /** Stories told as deep dives when the length has room for them, in the order told. */
  deep: readonly string[];
  /**
   * The owner's prompts (D182) by block key ("hello", "rundown", "close", "sign_off", and a story
   * block's key, the same as `blockPromptKey` in core). A block left out keeps its built-in prompt.
   */
  prompts?: Readonly<Record<string, string>>;
}

/** The key a story's block prompt is kept under. */
export function storyPromptKey(story: Pick<PodcastStory, "section" | "category">): string {
  const key = blockKey(story);
  if (key === TOP_PICKS_SECTION) return "top_picks";
  if (key === TRENDING_BLOCK_SECTION) return "trending";
  if (key === RELEASE_NEWS_SECTION) return "release_news";
  return `section:${key}`;
}

/** Characters an owner block is planned at: a turn or two. */
export const CUSTOM_BLOCK_CHARS = 250;

/** The block a story belongs to: Top picks, Trending and release news by what the digest filed. */
function blockKey(story: Pick<PodcastStory, "section" | "category">): string {
  if (story.section === TOP_PICKS_SECTION) return TOP_PICKS_SECTION;
  if (story.section === TRENDING_BLOCK_SECTION) return TRENDING_BLOCK_SECTION;
  if (story.section === RELEASE_NEWS_SECTION || story.category === RELEASE_CATEGORY) {
    return RELEASE_NEWS_SECTION;
  }
  return story.section;
}

function keyOf(block: StructureBlock): string | null {
  switch (block.type) {
    case "top_picks":
      return TOP_PICKS_SECTION;
    case "trending":
      return TRENDING_BLOCK_SECTION;
    case "release_news":
      return RELEASE_NEWS_SECTION;
    case "section":
      return block.id;
    default:
      return null;
  }
}

/**
 * Whether a story may air under this structure. Top picks, Trending and release news air only
 * while their block is in it. A section is chosen on the Catch up form, which filters for that one
 * request, so a story of a section the structure does not name still airs, after the named ones.
 */
export function airsUnder(
  blocks: readonly StructureBlock[],
  story: Pick<PodcastStory, "section" | "category">,
): boolean {
  const key = blockKey(story);
  if (key !== TOP_PICKS_SECTION && key !== TRENDING_BLOCK_SECTION && key !== RELEASE_NEWS_SECTION) {
    return true;
  }
  return blocks.some((block) => keyOf(block) === key);
}

/** The fewest stories an episode airs; selection never returns fewer. */
const MIN_EPISODE_STORIES = 2;

/**
 * `shapeStories` over more candidates than the episode has room for, cut back to `slots` by rank. A
 * block's count caps its stories after the ranking filled the slots, and an episode sized for 10
 * minutes halves them at 5, so the 2026-10-27 Catch up aired 6 of its 8 slots and told each story
 * longer than it could carry. Candidates beyond the slots stand in for what the caps cut; the
 * lowest-ranked of the shaped list go first, and the rest is shaped again so its order, its deep
 * dives and its owner blocks follow what stays.
 */
export function fitStories(
  candidates: readonly PodcastStory[],
  blocks: readonly StructureBlock[],
  prompts: Readonly<Record<string, string>>,
  slots: number,
): { stories: PodcastStory[]; shape: ScriptShape } {
  // An episode keeps its two stories (the selection's own floor) whatever the structure leaves room
  // for: a short episode with many blocks plans one slot and must not be cut under what select kept.
  const max = Math.max(MIN_EPISODE_STORIES, slots);
  const shaped = shapeStories(candidates, blocks, prompts);
  if (shaped.stories.length <= max) return shaped;
  // A story ranks by its place inside its own section first, so the cut takes each section's tail
  // before any section's best: a mixed episode lists its topics one after another, and cutting by
  // position alone would take the whole last topic (2026-10-28, independent review).
  const place = new Map<string, number>();
  const filled = new Map<string, number>();
  for (const story of candidates) {
    const before = filled.get(story.section) ?? 0;
    place.set(story.item_id, before);
    filled.set(story.section, before + 1);
  }
  const order = new Map(candidates.map((story, index) => [story.item_id, index]));
  const byRank = (a: PodcastStory, b: PodcastStory): number =>
    (place.get(a.item_id) ?? candidates.length) - (place.get(b.item_id) ?? candidates.length) ||
    (order.get(a.item_id) ?? candidates.length) - (order.get(b.item_id) ?? candidates.length);
  const kept = new Set(
    [...shaped.stories]
      .sort(byRank)
      .slice(0, max)
      .map((story) => story.item_id),
  );
  return shapeStories(
    candidates.filter((story) => kept.has(story.item_id)),
    blocks,
    prompts,
  );
}

/**
 * Order ranked stories by the structure: each block's stories in rank order, blocks in the
 * structure's order, then stories of sections it does not name. A block's count caps its stories.
 * Owner blocks land where they stand among the story blocks.
 */
export function shapeStories(
  stories: readonly PodcastStory[],
  blocks: readonly StructureBlock[],
  prompts: Readonly<Record<string, string>> = {},
): { stories: PodcastStory[]; shape: ScriptShape } {
  const byKey = new Map<string, PodcastStory[]>();
  for (const story of stories) {
    const key = blockKey(story);
    byKey.set(key, [...(byKey.get(key) ?? []), story]);
  }
  const ordered: PodcastStory[] = [];
  const deep: string[] = [];
  const customs: { title: string; brief: string; before: number }[] = [];
  const named = new Set<string>();
  for (const block of blocks) {
    if (block.type === "custom") {
      customs.push({ title: block.title, brief: block.brief, before: ordered.length });
      continue;
    }
    const key = keyOf(block);
    if (key === null) continue;
    named.add(key);
    const most =
      block.type === "section"
        ? block.max_stories
        : block.type === "top_picks" || block.type === "trending" || block.type === "release_news"
          ? block.stories
          : undefined;
    // A block's own count per outlet holds here too; its age limit is the form's window's to set.
    const perSource =
      block.type === "section" ||
      block.type === "top_picks" ||
      block.type === "trending" ||
      block.type === "release_news"
        ? block.per_source
        : undefined;
    const outlets = new Map<string, number>();
    const taken = (byKey.get(key) ?? [])
      .filter((story) => {
        if (perSource === undefined) return true;
        const outlet = outletOf({ url: story.url, source_id: story.source });
        const count = outlets.get(outlet) ?? 0;
        outlets.set(outlet, count + 1);
        return count < perSource;
      })
      .slice(0, most ?? Number.POSITIVE_INFINITY);
    const isDeep =
      (block.type === "section" || block.type === "top_picks") && block.depth === "deep";
    if (isDeep) deep.push(...taken.map((story) => story.item_id));
    ordered.push(...taken);
  }
  for (const story of stories) {
    if (!named.has(blockKey(story)) && airsUnder(blocks, story)) ordered.push(story);
  }
  const rundown = blocks.find((block) => block.type === "rundown");
  const close = blocks.find((block) => block.type === "close");
  return {
    stories: ordered,
    shape: {
      rundown: rundown === undefined ? false : (rundown.stories ?? null),
      close: close === undefined ? null : close.length,
      customs,
      deep,
      ...(Object.keys(prompts).length > 0 ? { prompts } : {}),
    },
  };
}
