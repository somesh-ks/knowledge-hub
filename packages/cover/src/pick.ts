import type { Category } from "@dispatch/core";
import { DARK_PALETTE_IDS, PALETTE_IDS } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import { TEMPLATES } from "./templates/index.js";
import type { CoverSpec, PickInput, TemplateId } from "./types.js";

/** Which templates a lead category pulls toward. Anything not listed gets the base weight of one. */
const BIAS: Record<Category | "watch", readonly TemplateId[]> = {
  design_engineering_craft: ["spring", "contour"],
  css_canvas_motion_techniques: ["spring", "contour"],
  ui_component_primitives: ["spring", "contour"],
  ai_ux_interaction_patterns: ["dither"],
  frontier_model_releases: ["dither"],
  hci_empirical_research: ["contour", "lattice"],
  developer_tool_launches: ["lattice", "aperture"],
  taste_and_design_philosophy: ["orbit", "numeral"],
  watch: ["band"],
  // Categories that never publish still get an entry so the table is total; no bias.
  venture_capital_and_gossip: [],
  generic_ai_hype_listicles: [],
};

/** A single favored template is pulled harder than one of a pair, so the bias is felt either way. */
function templateWeight(template: TemplateId, lead: PickInput["lead_category"]): number {
  const favored = lead ? BIAS[lead] : [];
  if (!favored.includes(template)) return 1;
  return favored.length === 1 ? 6 : 4;
}

/**
 * Chooses a cover for a digest. Deterministic from the digest id, never repeats the previous
 * digest's template or palette, leans toward the lead category's template, and draws weekly digests
 * from the dark palette family.
 */
export function pickCover(input: PickInput): CoverSpec {
  const rng = mulberry32(hash32(`pick:${input.id}`));
  const seed = hash32(`seed:${input.id}`);

  const templates = TEMPLATES.filter((t) => t !== input.previous?.template);
  const template = rng.weighted(templates, (t) => templateWeight(t, input.lead_category));

  const family = input.kind === "weekly" ? DARK_PALETTE_IDS : PALETTE_IDS;
  const palettes = family.filter((id) => id !== input.previous?.palette);
  const palette = rng.pick(palettes.length > 0 ? palettes : PALETTE_IDS);

  return { template, palette, seed };
}
