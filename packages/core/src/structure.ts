import { z } from "zod";
import { BLOCK_PROMPT_MAX } from "./blockPrompts.js";
import { type SECTIONS, SectionId } from "./categories.js";

/**
 * The podcast structure (D170, docs/design/podcast-structure.md): one ordered list of blocks per
 * podcast kind, kept in config/structure.json. A missing file, or a kind the file leaves out, means
 * that kind's defaults, which the engine runs exactly as it did before the structure existed.
 */

/** The kinds a structure is kept for. Daily and weekly are briefings; Catch up is the Create form. */
export const STRUCTURE_KINDS = ["daily", "weekly", "catch_up"] as const;
export const StructureKind = z.enum(STRUCTURE_KINDS);
export type StructureKind = z.infer<typeof StructureKind>;

/** The Top picks, Trending and release news sections, which have blocks of their own. */
export const TOP_PICKS_SECTION = "top";
export const TRENDING_BLOCK_SECTION = "trending";
export const RELEASE_NEWS_SECTION = "launches";

/** Built-in sections a `section` block may name: the filed ones that have no block of their own. */
export const STRUCTURE_SECTIONS = [
  "design",
  "ui-craft",
  "software",
  "ai",
  "tech",
] as const satisfies readonly (typeof SECTIONS)[number][];

/**
 * More blocks than the design's twelve: each custom topic (twelve at most) and each general topic
 * brings a section of its own, so a structure that lists them all needs the room.
 */
export const MAX_STRUCTURE_BLOCKS = 32;
export const CUSTOM_BRIEF_MAX = 280;
/** Owner blocks a structure may hold, so a whole kind fits one settings request (8192 characters). */
export const MAX_CUSTOM_BLOCKS = 6;
export const CUSTOM_TITLE_MAX = 60;

const Depth = z.enum(["deep", "brief"]);
export type BlockDepth = z.infer<typeof Depth>;

/**
 * Settings a story block holds that code enforces exactly, whatever model writes (the owner,
 * 2026-10-24: "deterministic parameters ... we've gotta stay robust"). `per_source` is the most
 * stories one outlet may bring to the block; absent means the engine's own (two per outlet across
 * the briefing). How far back a podcast looks is the kind's, not a block's (owner, 2026-10-24).
 */
export const PER_SOURCE_MAX = 4;
const StoryRules = {
  per_source: z.number().int().min(1).max(PER_SOURCE_MAX).optional(),
};

/**
 * Counts are optional on purpose: absent means the engine's own allowance (three Top picks, five
 * stories for a section with an allowance of its own, the length's rundown), which is how the
 * defaults reproduce today's episodes without copying today's constants into the file.
 */
const HelloBlock = z.object({ type: z.literal("hello") });
const RundownBlock = z.object({
  type: z.literal("rundown"),
  stories: z.number().int().min(1).max(6).optional(),
});
const SectionBlock = z.object({
  type: z.literal("section"),
  /** A built-in section or the section a topic defines. */
  id: SectionId,
  depth: Depth.default("brief"),
  max_stories: z.number().int().min(1).max(8).optional(),
  ...StoryRules,
});
const TopPicksBlock = z.object({
  type: z.literal("top_picks"),
  stories: z.number().int().min(1).max(6).optional(),
  depth: Depth.default("deep"),
  ...StoryRules,
});
const TrendingBlock = z.object({
  type: z.literal("trending"),
  stories: z.number().int().min(1).max(8).optional(),
  ...StoryRules,
});
const ReleaseNewsBlock = z.object({
  type: z.literal("release_news"),
  stories: z.number().int().min(1).max(8).optional(),
  ...StoryRules,
});
const CustomBlock = z.object({
  type: z.literal("custom"),
  title: z.string().trim().min(1).max(CUSTOM_TITLE_MAX),
  /** Typed by the owner: it reaches the writer quoted, as an instruction, never as a fact. */
  brief: z.string().trim().min(1).max(CUSTOM_BRIEF_MAX),
});
const CloseBlock = z.object({
  type: z.literal("close"),
  length: z.enum(["short", "long"]).default("short"),
});
const SignOffBlock = z.object({ type: z.literal("sign_off") });

export const StructureBlock = z.discriminatedUnion("type", [
  HelloBlock,
  RundownBlock,
  SectionBlock,
  TopPicksBlock,
  TrendingBlock,
  ReleaseNewsBlock,
  CustomBlock,
  CloseBlock,
  SignOffBlock,
]);
export type StructureBlock = z.output<typeof StructureBlock>;
export type StructureBlockInput = z.input<typeof StructureBlock>;
export type StructureBlockType = StructureBlock["type"];

/** Blocks that may appear once at most. A section and a custom block may repeat. */
const SINGLETONS: readonly StructureBlockType[] = [
  "hello",
  "rundown",
  "top_picks",
  "trending",
  "release_news",
  "close",
  "sign_off",
];

/**
 * Drop the section blocks of topics that no longer exist, keeping the rest in order. A removed
 * topic is never an error when the structure is read, as `digestSections` already tolerates.
 */
export function withKnownSections(
  blocks: readonly StructureBlock[],
  known: ReadonlySet<string>,
): StructureBlock[] {
  return blocks.filter((block) => block.type !== "section" || known.has(block.id));
}

/** The rules a structure holds, as messages for the person who sent it; empty when it is sound. */
export function structureProblems(blocks: readonly StructureBlockInput[]): string[] {
  const problems: string[] = [];
  if (blocks.length > MAX_STRUCTURE_BLOCKS) {
    problems.push(`A structure holds at most ${MAX_STRUCTURE_BLOCKS} blocks.`);
  }
  if (blocks[0]?.type !== "hello") problems.push("A structure starts with the hello.");
  if (blocks[blocks.length - 1]?.type !== "sign_off") {
    problems.push("A structure ends with the sign-off.");
  }
  for (const type of SINGLETONS) {
    if (blocks.filter((block) => block.type === type).length > 1) {
      problems.push(`A structure has one ${type.replace("_", " ")} at most.`);
    }
  }
  if (blocks.filter((block) => block.type === "custom").length > MAX_CUSTOM_BLOCKS) {
    problems.push(`A structure holds at most ${MAX_CUSTOM_BLOCKS} blocks of your own.`);
  }
  const sections = blocks.flatMap((block) => (block.type === "section" ? [block.id] : []));
  const repeated = sections.filter((id, index) => sections.indexOf(id) !== index);
  if (repeated.length > 0) problems.push(`The section ${repeated[0]} is in the structure twice.`);
  const reserved = sections.filter(
    (id) =>
      id === TOP_PICKS_SECTION || id === TRENDING_BLOCK_SECTION || id === RELEASE_NEWS_SECTION,
  );
  if (reserved.length > 0) {
    problems.push(`The section ${reserved[0]} has a block of its own, not a section block.`);
  }
  if (!blocks.some((block) => block.type !== "hello" && block.type !== "sign_off")) {
    problems.push("A structure needs at least one block between the hello and the sign-off.");
  }
  return problems;
}

/** One kind's blocks, in order, with the rules above. */
export const StructureBlocks = z
  .array(StructureBlock)
  .min(2)
  .superRefine((blocks, ctx) => {
    for (const message of structureProblems(blocks)) ctx.addIssue({ code: "custom", message });
  });

/**
 * The name a block's prompt is kept under (blockPromptKey): a block type a model writes, or
 * `section:<id>`. Which blocks a model writes in which podcast is the engine's to know.
 */
export const BlockPromptKey = z
  .string()
  .regex(
    /^(hello|rundown|top_picks|trending|release_news|close|sign_off|section:[a-z0-9][a-z0-9-]*)$/,
  );
export const BlockPrompt = z.string().trim().min(1).max(BLOCK_PROMPT_MAX);

/**
 * The listener profiles (owner, 2026-10-25): the structure does not vary by podcast type but by who
 * listens. A named profile is a preset list of blocks; Custom is the owner's own list.
 */
export const NAMED_PROFILES = [
  "artist",
  "designer",
  "founder",
  "general",
  "journalist",
  "product_manager",
  "researcher",
  "software_engineer",
  "student",
] as const;
export const STRUCTURE_PROFILES = [...NAMED_PROFILES, "custom"] as const;
export const StructureProfile = z.enum(STRUCTURE_PROFILES);
export type StructureProfile = z.infer<typeof StructureProfile>;
export type NamedProfile = (typeof NAMED_PROFILES)[number];

/** What a profile is called, in the order the select lists them (alphabetical, Custom last). */
export const PROFILE_LABEL: Record<StructureProfile, string> = {
  artist: "Artist",
  designer: "Designer",
  founder: "Founder",
  general: "General",
  journalist: "Journalist",
  product_manager: "Product Manager",
  researcher: "Researcher",
  software_engineer: "Software Engineer",
  student: "Student",
  custom: "Custom",
};

/** One plain line on what a profile changes in an episode: the card on Preferences shows it. */
export const PROFILE_NOTE: Record<StructureProfile, string> = {
  artist: "Leans on design and visual craft, with a little AI and tech.",
  designer: "Design and interface craft first, then AI, tech and launches.",
  founder: "Tech, AI and what is trending, with a nod to design and launches.",
  general: "A balanced mix of design, software, AI and tech.",
  journalist: "More top stories and trending news, fewer deep dives.",
  product_manager: "AI and tech first, then design, with launches and software.",
  researcher: "Heavy on AI, with software, tech and launches.",
  software_engineer: "Software and launches first, then AI and tech.",
  student: "AI, software and tech, to build a broad footing.",
  custom: "Your own list of blocks, kept as you edited it.",
};

/** Minutes the presets' counts are written for; an episode of another length scales them. */
export const REFERENCE_MINUTES = 10;

type Recipe = readonly (readonly [string, number])[];

/**
 * Each preset's body at the reference length: a block key (the Top picks, Trending and release
 * news section ids, or a section id) and its story count. Top picks run in depth, the rest short.
 */
const PRESETS: Record<NamedProfile, Recipe> = {
  artist: [
    ["top", 3],
    ["design", 3],
    ["ui-craft", 2],
    ["ai", 2],
    ["trending", 2],
    ["tech", 1],
  ],
  designer: [
    ["top", 3],
    ["design", 3],
    ["ui-craft", 3],
    ["ai", 2],
    ["tech", 2],
    ["trending", 2],
    ["launches", 1],
  ],
  founder: [
    ["top", 3],
    ["tech", 3],
    ["ai", 3],
    ["trending", 3],
    ["design", 1],
    ["launches", 1],
  ],
  general: [
    ["top", 3],
    ["design", 2],
    ["ui-craft", 1],
    ["software", 2],
    ["ai", 2],
    ["tech", 2],
    ["trending", 2],
    ["launches", 1],
  ],
  journalist: [
    ["top", 4],
    ["trending", 4],
    ["tech", 2],
    ["ai", 2],
    ["design", 1],
  ],
  product_manager: [
    ["top", 3],
    ["ai", 3],
    ["tech", 3],
    ["design", 2],
    ["trending", 2],
    ["software", 1],
    ["launches", 1],
  ],
  researcher: [
    ["top", 3],
    ["ai", 4],
    ["software", 2],
    ["tech", 2],
    ["trending", 1],
    ["launches", 2],
  ],
  software_engineer: [
    ["top", 3],
    ["software", 4],
    ["ai", 3],
    ["tech", 2],
    ["trending", 2],
    ["ui-craft", 1],
    ["launches", 3],
  ],
  student: [
    ["top", 3],
    ["ai", 3],
    ["software", 2],
    ["tech", 2],
    ["trending", 2],
    ["design", 1],
  ],
};

/**
 * A named profile's blocks. The owner's topic sections (`extra`) follow the built-in ones, before
 * release news, so a topic still plays under a preset.
 */
export function profileBlocks(
  profile: NamedProfile,
  extra: readonly string[] = [],
): StructureBlock[] {
  const body = PRESETS[profile].map(([key, stories]): StructureBlock => {
    if (key === TOP_PICKS_SECTION) return { type: "top_picks", stories, depth: "deep" };
    if (key === TRENDING_BLOCK_SECTION) return { type: "trending", stories };
    if (key === RELEASE_NEWS_SECTION) return { type: "release_news", stories };
    return {
      type: "section",
      id: key as (typeof STRUCTURE_SECTIONS)[number],
      depth: "brief",
      max_stories: stories,
    };
  });
  const blocks: StructureBlock[] = [{ type: "hello" }, ...body, { type: "sign_off" }];
  return extra.reduce((all, id) => withSectionBlock(all, id), blocks);
}

const scaled = (count: number | undefined, minutes: number, max: number): number | undefined =>
  count === undefined
    ? undefined
    : Math.min(max, Math.max(1, Math.round((count * minutes) / REFERENCE_MINUTES)));

/**
 * The structure sized to an episode: every explicit story count grows or shrinks with the episode's
 * length against the reference, so a 5 minute daily brings fewer stories per block than a 15 minute
 * weekly from the same list. A block that leaves its count to the engine stays so.
 */
export function scaleStructure(
  blocks: readonly StructureBlock[],
  minutes: number,
): StructureBlock[] {
  return blocks.map((block) => {
    if (block.type === "section") {
      const count = scaled(block.max_stories, minutes, 8);
      return count === undefined ? block : { ...block, max_stories: count };
    }
    if (block.type === "top_picks" || block.type === "rundown") {
      const count = scaled(block.stories, minutes, 6);
      return count === undefined ? block : { ...block, stories: count };
    }
    if (block.type === "trending" || block.type === "release_news") {
      const count = scaled(block.stories, minutes, 8);
      return count === undefined ? block : { ...block, stories: count };
    }
    return block;
  });
}

const StructureShape = z.object({
  version: z.literal(1),
  /** The active listener profile. Absent (an owner who never chose) is the defaults. */
  profile: StructureProfile.optional(),
  /** The list itself: written for Custom; a named profile may leave it out and is read as its preset. */
  blocks: StructureBlocks.optional(),
  /**
   * The owner's own list, kept while a named profile runs, so choosing Custom again restores it
   * (owner, 2026-10-27: "keep the custom blocks so a reset restores them").
   */
  custom_blocks: StructureBlocks.optional(),
  /**
   * The owner's replacement prompts (D182), by block key. Kept apart from the blocks so a reorder
   * never carries several thousand characters, and so a block removed and put back keeps its
   * prompt. A prompt whose block is not in the structure is never read.
   */
  prompts: z.record(BlockPromptKey, BlockPrompt).optional(),
});

/**
 * The shape before the profiles: one list and one set of prompts per podcast kind. Read for
 * backward compatibility as Custom, taking the daily list or else the first present, and the
 * kinds' prompts merged (daily's winning); the next save writes the new shape.
 */
function fromKinds(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !("kinds" in input)) return input;
  const old = input as {
    version?: unknown;
    kinds?: Partial<Record<StructureKind, unknown>>;
    prompts?: Partial<Record<StructureKind, Record<string, unknown>>>;
  };
  const kinds = old.kinds ?? {};
  const blocks = kinds.daily ?? kinds.weekly ?? kinds.catch_up;
  const prompts = Object.assign({}, old.prompts?.catch_up, old.prompts?.weekly, old.prompts?.daily);
  return {
    version: old.version,
    ...(blocks === undefined ? {} : { profile: "custom", blocks }),
    ...(Object.keys(prompts).length > 0 ? { prompts } : {}),
  };
}

/** Shape of config/structure.json; a named profile without a list reads as its preset's blocks. */
export const StructureFile = z.preprocess(fromKinds, StructureShape).transform((file) => ({
  ...file,
  ...(file.blocks === undefined && file.profile !== undefined && file.profile !== "custom"
    ? { blocks: profileBlocks(file.profile) }
    : {}),
}));
export type StructureFile = z.output<typeof StructureShape>;

/**
 * What a kind runs on today, the defaults: Top picks, the filed built-in sections in their fixed
 * order, Trending, then the sections of the owner's topics (`extra`, in the order given), then
 * release news, which closes a briefing. Daily and weekly have no rundown and no close, since the
 * narration never had one; Catch up has both, as the script writer always wrote them.
 */
export function defaultStructure(
  kind: StructureKind,
  extra: readonly string[] = [],
): StructureBlock[] {
  const sections: StructureBlock[] = [
    ...STRUCTURE_SECTIONS.map((id) => ({ type: "section" as const, id, depth: "brief" as const })),
    ...extra
      .filter((id, index) => extra.indexOf(id) === index && !isBlockSection(id))
      .filter((id) => !(STRUCTURE_SECTIONS as readonly string[]).includes(id))
      .map((id) => ({ type: "section" as const, id, depth: "brief" as const })),
  ];
  const body: StructureBlock[] = [
    { type: "top_picks", depth: "deep" },
    ...sections.slice(0, STRUCTURE_SECTIONS.length),
    { type: "trending" },
    ...sections.slice(STRUCTURE_SECTIONS.length),
    { type: "release_news" },
  ];
  if (kind === "catch_up") {
    return [
      { type: "hello" },
      { type: "rundown" },
      ...body,
      { type: "close", length: "short" },
      { type: "sign_off" },
    ];
  }
  return [{ type: "hello" }, ...body, { type: "sign_off" }];
}

/** True for a section id that a block of its own stands for (Top picks, Trending, release news). */
export function isBlockSection(id: string): boolean {
  return id === TOP_PICKS_SECTION || id === TRENDING_BLOCK_SECTION || id === RELEASE_NEWS_SECTION;
}

/** The active structure's blocks, for every podcast kind, or null while the defaults apply. */
export function storedStructure(file: StructureFile | null): StructureBlock[] | null {
  return file?.blocks ?? null;
}

/**
 * The sections a structure reads, in order, as the digest files them: Top picks, Trending and
 * release news by their section ids, a `section` block by its own id.
 */
export function structureSectionOrder(blocks: readonly StructureBlock[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "top_picks":
        return [TOP_PICKS_SECTION];
      case "trending":
        return [TRENDING_BLOCK_SECTION];
      case "release_news":
        return [RELEASE_NEWS_SECTION];
      case "section":
        return [block.id];
      default:
        return [];
    }
  });
}

/** Most stories a section may hold under this structure, or null for the engine's own allowance. */
export function sectionLimit(blocks: readonly StructureBlock[], section: string): number | null {
  for (const block of blocks) {
    if (block.type === "section" && block.id === section) return block.max_stories ?? null;
    if (block.type === "top_picks" && section === TOP_PICKS_SECTION) return block.stories ?? null;
    if (block.type === "trending" && section === TRENDING_BLOCK_SECTION) {
      return block.stories ?? null;
    }
    if (block.type === "release_news" && section === RELEASE_NEWS_SECTION) {
      return block.stories ?? null;
    }
  }
  return null;
}

/**
 * Add a topic's section to every stored kind that lacks it, before release news (or the close or
 * sign-off when there is none), so a topic made after the structure was saved still plays. A kind
 * on its defaults is left alone: the defaults list every topic already.
 */
export function withSection(file: StructureFile, section: string): StructureFile {
  if (isBlockSection(section) || file.blocks === undefined) return file;
  return { ...file, blocks: withSectionBlock(file.blocks, section) };
}

export function withSectionBlock(
  blocks: readonly StructureBlock[],
  section: string,
): StructureBlock[] {
  // Top picks, Trending and release news have blocks of their own, which the owner places.
  if (isBlockSection(section)) return [...blocks];
  if (blocks.some((block) => block.type === "section" && block.id === section)) return [...blocks];
  if (blocks.length >= MAX_STRUCTURE_BLOCKS) return [...blocks];
  const before = blocks.findIndex(
    (block) => block.type === "release_news" || block.type === "close" || block.type === "sign_off",
  );
  const at = before < 0 ? blocks.length : before;
  return [
    ...blocks.slice(0, at),
    { type: "section", id: section, depth: "brief" },
    ...blocks.slice(at),
  ];
}

/** Drop a removed topic's section from the stored list; a list left with no body keeps it. */
export function withoutSection(file: StructureFile, section: string): StructureFile {
  // The kept Custom list too: choosing Custom again must not bring back a section that is gone.
  const without = (blocks: StructureFile["blocks"]): StructureFile["blocks"] | null => {
    if (blocks === undefined) return undefined;
    const next = blocks.filter((block) => block.type !== "section" || block.id !== section);
    return structureProblems(next).length === 0 ? next : null;
  };
  // The running list keeps the section when it is its last (a list needs one); a kept list that
  // would be left with none is dropped, so Custom starts from the running list instead.
  const blocks = without(file.blocks) ?? file.blocks;
  const custom_blocks = without(file.custom_blocks);
  const { custom_blocks: _kept, ...rest } = file;
  return {
    ...rest,
    ...(blocks === undefined ? {} : { blocks }),
    ...(custom_blocks ? { custom_blocks } : {}),
  };
}

/** The owner's prompt for a block, or null for the built-in one. */
export function storedBlockPrompt(file: StructureFile | null, key: string): string | null {
  return file?.prompts?.[key] ?? null;
}

/** A story block's own rules for a section, or none when no block names it or it sets none. */
export function blockStoryRules(
  blocks: readonly StructureBlock[],
  section: string,
): { per_source?: number } {
  for (const block of blocks) {
    const named =
      (block.type === "section" && block.id === section) ||
      (block.type === "top_picks" && section === TOP_PICKS_SECTION) ||
      (block.type === "trending" && section === TRENDING_BLOCK_SECTION) ||
      (block.type === "release_news" && section === RELEASE_NEWS_SECTION);
    if (!named) continue;
    if (
      block.type === "section" ||
      block.type === "top_picks" ||
      block.type === "trending" ||
      block.type === "release_news"
    ) {
      return block.per_source === undefined ? {} : { per_source: block.per_source };
    }
  }
  return {};
}
