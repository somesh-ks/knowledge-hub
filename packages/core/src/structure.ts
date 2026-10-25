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

/** Shape of config/structure.json. A kind left out runs on its defaults. */
/**
 * Blocks only a kind written by the script writer can follow. Daily and weekly are narrated by
 * code around stories written one by one, so a close or an owner's brief has nobody to write it
 * there (the owner chose Catch up only, 2026-10-24, D176); their rundown is read from the chapters.
 */
export const SCRIPT_ONLY_BLOCKS: readonly StructureBlockType[] = ["close", "custom"];

/** What a kind refuses beyond the shared rules; empty when the blocks fit the kind. */
export function kindProblems(
  kind: StructureKind,
  blocks: readonly StructureBlockInput[],
): string[] {
  if (kind === "catch_up") return [];
  const refused = blocks.find((block) => SCRIPT_ONLY_BLOCKS.includes(block.type));
  return refused === undefined
    ? []
    : [
        `A ${kind} episode has no ${refused.type === "custom" ? "block of your own" : "close"}; only Catch up does.`,
      ];
}

/**
 * The name a block's prompt is kept under (blockPromptKey): a block type a model writes, or
 * `section:<id>`. The kinds' own rules (which blocks a model writes there) are checked below.
 */
export const BlockPromptKey = z
  .string()
  .regex(
    /^(hello|rundown|top_picks|trending|release_news|close|sign_off|section:[a-z0-9][a-z0-9-]*)$/,
  );
export const BlockPrompt = z.string().trim().min(1).max(BLOCK_PROMPT_MAX);

/** Blocks a daily or weekly episode lets the owner prompt: code speaks the rest. */
const BRIEFING_PROMPT_KEY = /^(top_picks|trending|release_news|section:.+)$/;

/** What a kind refuses of the prompts kept for it; empty when they fit the kind. */
export function promptProblems(kind: StructureKind, keys: readonly string[]): string[] {
  if (kind === "catch_up") return [];
  const refused = keys.find((key) => !BRIEFING_PROMPT_KEY.test(key));
  return refused === undefined
    ? []
    : [`A ${kind} episode speaks its ${refused.replace("_", " ")} in code, so it has no prompt.`];
}

export const StructureFile = z
  .object({
    version: z.literal(1),
    kinds: z.partialRecord(StructureKind, StructureBlocks),
    /**
     * The owner's replacement prompts (D182), by kind and block key. Kept apart from the blocks so
     * a reorder never carries several thousand characters, and so a block removed and put back
     * keeps its prompt. A prompt whose block is not in the structure is never read.
     */
    prompts: z.partialRecord(StructureKind, z.record(BlockPromptKey, BlockPrompt)).optional(),
  })
  .superRefine((file, ctx) => {
    for (const kind of STRUCTURE_KINDS) {
      for (const message of kindProblems(kind, file.kinds[kind] ?? [])) {
        ctx.addIssue({ code: "custom", message, path: ["kinds", kind] });
      }
      for (const message of promptProblems(kind, Object.keys(file.prompts?.[kind] ?? {}))) {
        ctx.addIssue({ code: "custom", message, path: ["prompts", kind] });
      }
    }
  });
export type StructureFile = z.infer<typeof StructureFile>;

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

/** The kind's stored blocks, or null when the owner never edited it and the defaults apply. */
export function storedStructure(
  file: StructureFile | null,
  kind: StructureKind,
): StructureBlock[] | null {
  return file?.kinds[kind] ?? null;
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
  if (isBlockSection(section)) return file;
  const kinds: StructureFile["kinds"] = {};
  for (const kind of STRUCTURE_KINDS) {
    const blocks = file.kinds[kind];
    if (blocks === undefined) continue;
    kinds[kind] = withSectionBlock(blocks, section);
  }
  return { ...file, kinds };
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

/** Drop a removed topic's section from every stored kind; a kind left with no body keeps it. */
export function withoutSection(file: StructureFile, section: string): StructureFile {
  const kinds: StructureFile["kinds"] = {};
  for (const kind of STRUCTURE_KINDS) {
    const blocks = file.kinds[kind];
    if (blocks === undefined) continue;
    const next = blocks.filter((block) => block.type !== "section" || block.id !== section);
    kinds[kind] = structureProblems(next).length === 0 ? next : blocks;
  }
  return { ...file, kinds };
}

/** The owner's prompt for a block in a kind, or null for the built-in one. */
export function storedBlockPrompt(
  file: StructureFile | null,
  kind: StructureKind,
  key: string,
): string | null {
  return file?.prompts?.[kind]?.[key] ?? null;
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
