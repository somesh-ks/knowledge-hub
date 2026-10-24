import {
  type DigestKind,
  isBuiltinSection,
  SECTIONS,
  type StructureBlock,
  type StructureKind,
  sectionLimit,
  storedStructure,
  structureSectionOrder,
  TOP_PICKS_SECTION,
} from "@singularity/core";
import { loadStructureFile } from "../structure/store.js";

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
}

/** Stories a briefing's rundown names when its block leaves the count to the engine. */
export const DEFAULT_RUNDOWN = 3;

export const DEFAULT_SECTION_PLAN: SectionPlan = {
  order: null,
  topPicks: DEFAULT_TOP_PICKS,
  includes: () => true,
  limit: () => null,
  rundown: null,
};

/** The plan for a kind's stored blocks; null blocks (the kind was never edited) give the default. */
export function sectionPlanFor(blocks: readonly StructureBlock[] | null): SectionPlan {
  if (blocks === null) return DEFAULT_SECTION_PLAN;
  const order = structureSectionOrder(blocks);
  const listed = new Set(order);
  return {
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

/** The plan config/structure.json gives a digest kind, or the default when it has none. */
export async function loadSectionPlan(root: string, kind: DigestKind): Promise<SectionPlan> {
  const structureKind = structureKindOf(kind);
  if (structureKind === null) return DEFAULT_SECTION_PLAN;
  return sectionPlanFor(storedStructure(await loadStructureFile(root), structureKind));
}

/**
 * True when built-in sections in this order read differently from their fixed order, so the
 * digest must keep the order in its `section_titles` snapshot (digestSections reads it first).
 */
export function departsFromBuiltinOrder(used: readonly string[]): boolean {
  const ranks = used.filter(isBuiltinSection).map((section) => SECTIONS.indexOf(section));
  return ranks.some((rank, index) => index > 0 && rank < (ranks[index - 1] ?? 0));
}
