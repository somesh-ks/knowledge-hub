import {
  RELEASE_NEWS_SECTION,
  type StructureBlock,
  TOP_PICKS_SECTION,
  TRENDING_BLOCK_SECTION,
} from "@dispatch/core";
import { RELEASE_CATEGORY } from "../score/releaseNotes.js";
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
   * The owner's prompts (D178) by block key ("hello", "rundown", "close", "sign_off", and a story
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
    const taken = (byKey.get(key) ?? []).slice(0, most ?? Number.POSITIVE_INFINITY);
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
