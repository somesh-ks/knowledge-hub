import {
  blockStoryRules,
  type DigestKind,
  effectiveSkipTopics,
  GENERAL_TOPICS,
  hasOwnAllowance,
  isBuiltinSection,
  RELEASE_NEWS_SECTION,
  SECTIONS,
  type StructureBlock,
  type StructureFile,
  type StructureKind,
  scaleStructure,
  sectionLimit,
  storedStructure,
  structureSectionOrder,
  TOP_PICKS_SECTION,
  TRENDING_BLOCK_SECTION,
} from "@singularity/core";
import { loadSchedule } from "../schedule/store.js";
import { loadStructureFile } from "../structure/store.js";

/** Stories a ticked general section the structure left out holds in a reference-length episode. */
const ADDED_SECTION_STORIES = 5;

/** Top picks a briefing carries when its structure leaves the count to the engine. */
export const DEFAULT_TOP_PICKS = 3;

/**
 * What a briefing's structure (D170) asks of selection and of the digest: the order its sections
 * read in, how many Top picks it carries, which sections it carries at all and how many stories
 * each may hold. The default plan is the engine as it was before the structure existed.
 */
export interface SectionPlan {
  /** Sections in reading order, or null for the built-in order. */
  order: readonly string[] | null;
  topPicks: number;
  /** False for a section the stored structure leaves out. */
  includes(section: string): boolean;
  /** Most stories the structure allows the section, or null for the engine's own allowance. */
  limit(section: string): number | null;
  /** Stories the narration's rundown names, or null for no rundown. */
  rundown: number | null;
  /** The owner's prompt for the section's stories (D182), or undefined for the built-in one. */
  prompt(section: string): string | undefined;
  /** The block's own rules for its stories: most per outlet and how old they may be. */
  rules(section: string): { per_source?: number };
}

/** Stories a briefing's rundown names when its block leaves the count to the engine. */
export const DEFAULT_RUNDOWN = 3;

export const DEFAULT_SECTION_PLAN: SectionPlan = {
  order: null,
  topPicks: DEFAULT_TOP_PICKS,
  includes: () => true,
  limit: () => null,
  rundown: null,
  prompt: () => undefined,
  rules: () => ({}),
};

/**
 * The plan a sized briefing's reserve is chosen under: the structure's story counts of the main
 * sections no longer apply (they must not empty the reserve), but a section with an allowance of
 * its own (Tech releases, custom sections) keeps it, because validation trims a story past it
 * whatever its score (2026-10-31: three Tech stories written for the refill, all trimmed).
 */
export function reservePlan(plan: SectionPlan): SectionPlan {
  return { ...plan, limit: (section) => (hasOwnAllowance(section) ? plan.limit(section) : null) };
}

/** The key a section's block prompt is kept under (blockPromptKey in core). */
export function sectionPromptKey(section: string): string {
  if (section === TOP_PICKS_SECTION) return "top_picks";
  if (section === TRENDING_BLOCK_SECTION) return "trending";
  if (section === RELEASE_NEWS_SECTION) return "release_news";
  return `section:${section}`;
}

/**
 * The plan for a kind's stored blocks; null blocks (the kind was never edited) give the default
 * order and counts. `prompts` are the kind's block prompts, which apply either way.
 */
export function sectionPlanFor(
  blocks: readonly StructureBlock[] | null,
  prompts: Readonly<Record<string, string>> = {},
): SectionPlan {
  const prompt = (section: string): string | undefined => prompts[sectionPromptKey(section)];
  if (blocks === null) return { ...DEFAULT_SECTION_PLAN, prompt };
  const order = structureSectionOrder(blocks);
  const listed = new Set(order);
  return {
    prompt,
    rules: (section) => blockStoryRules(blocks, section),
    order,
    topPicks: listed.has(TOP_PICKS_SECTION)
      ? (sectionLimit(blocks, TOP_PICKS_SECTION) ?? DEFAULT_TOP_PICKS)
      : 0,
    includes: (section) => listed.has(section),
    limit: (section) => sectionLimit(blocks, section),
    rundown: rundownOf(blocks),
  };
}

function rundownOf(blocks: readonly StructureBlock[]): number | null {
  const block = blocks.find((entry) => entry.type === "rundown");
  return block?.type === "rundown" ? (block.stories ?? DEFAULT_RUNDOWN) : null;
}

/** The structure a digest kind follows. A briefing made on request has none of its own. */
export function structureKindOf(kind: DigestKind): StructureKind | null {
  if (kind === "regular") return "daily";
  if (kind === "weekly") return "weekly";
  return null;
}

/**
 * The plan config/structure.json gives a digest kind, or the default when it has none. The one
 * structure serves every kind; its story counts are sized to the kind's configured length, or to
 * the length this run was asked for (a Regenerate's Length), so a 15-minute run is not held to the
 * section counts of a 5-minute daily.
 */
export async function loadSectionPlan(
  root: string,
  kind: DigestKind,
  asked?: number,
): Promise<SectionPlan> {
  const structureKind = structureKindOf(kind);
  if (structureKind === null) return DEFAULT_SECTION_PLAN;
  const file: StructureFile | null = await loadStructureFile(root);
  const stored = storedStructure(file);
  if (stored === null) return sectionPlanFor(null, file?.prompts);
  const schedule = await loadSchedule(root);
  const scope = structureKind === "weekly" ? "weekly" : "daily";
  const minutes =
    asked ?? (scope === "weekly" ? schedule.weekly.length_minutes : schedule.length_minutes);
  const ticked = withTickedGeneralSections(stored, effectiveSkipTopics(schedule, scope));
  return sectionPlanFor(scaleStructure(ticked, minutes), file?.prompts);
}

/**
 * The structure with a section for each general news topic the podcast has ticked and the list
 * leaves out. A profile's preset lists none of them, so World, Business and Science, ticked on the
 * 2026-10-29 daily, lost 36 of its 53 qualifying stories as `not_in_structure` and it aired 3.8 of
 * 5 minutes. They go before the sign-off. Each holds `ADDED_SECTION_STORIES` at the reference
 * length and scales with the episode (scaleStructure), not the flat two of a general section: with
 * the flat two the same run still selected only 11 of 52, and the owner's rule is that the
 * settings length is the only size limit (#147).
 */
export function withTickedGeneralSections(
  blocks: readonly StructureBlock[],
  skipped: readonly string[],
): StructureBlock[] {
  const listed = new Set(structureSectionOrder(blocks));
  const added: StructureBlock[] = GENERAL_TOPICS.filter(
    (topic) => !skipped.includes(topic.id) && !listed.has(topic.id),
  ).map((topic) => ({
    type: "section",
    id: topic.id,
    depth: "brief",
    max_stories: ADDED_SECTION_STORIES,
  }));
  if (added.length === 0) return [...blocks];
  const close = blocks.findIndex((block) => block.type === "sign_off");
  return close < 0
    ? [...blocks, ...added]
    : [...blocks.slice(0, close), ...added, ...blocks.slice(close)];
}

/**
 * True when built-in sections in this order read differently from their fixed order, so the
 * digest must keep the order in its `section_titles` snapshot (digestSections reads it first).
 */
export function departsFromBuiltinOrder(used: readonly string[]): boolean {
  const ranks = used.filter(isBuiltinSection).map((section) => SECTIONS.indexOf(section));
  return ranks.some((rank, index) => index > 0 && rank < (ranks[index - 1] ?? 0));
}
