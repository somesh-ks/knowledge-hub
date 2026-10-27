// Kept apart from structure.ts, with types only, so the site's editor runs it without zod.
import type { StructureBlock, StructureProfile } from "./structure.js";

/** The profile, the list it runs, and the owner's own list kept aside while a named profile runs. */
export interface StructureChoice {
  profile: StructureProfile;
  blocks?: StructureBlock[];
  custom_blocks?: StructureBlock[];
}

/**
 * Choose a profile (owner, 2026-10-27). A named profile runs `preset` and keeps the owner's own list aside; Custom puts that list back exactly.
 */
export function chooseProfile(
  was: StructureChoice,
  next: StructureProfile,
  preset: StructureBlock[] | undefined,
): StructureChoice {
  const own = was.custom_blocks ?? (was.profile === "custom" ? was.blocks : undefined);
  if (next === "custom") {
    const blocks = own ?? was.blocks;
    return { profile: "custom", ...(blocks === undefined ? {} : { blocks }) };
  }
  return {
    profile: next,
    ...(preset === undefined ? {} : { blocks: preset }),
    ...(own === undefined ? {} : { custom_blocks: own }),
  };
}

/**
 * An edit of the list makes it Custom. On a named profile that keeps the owner's own list, the edit
 * would replace that list, so it applies only once `confirmed`; null asks first.
 */
export function editStructure(
  was: StructureChoice,
  blocks: StructureBlock[],
  confirmed: boolean,
): StructureChoice | null {
  if (was.profile !== "custom" && was.custom_blocks !== undefined && !confirmed) return null;
  return { profile: "custom", blocks };
}
