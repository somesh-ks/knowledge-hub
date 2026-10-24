import type { Category } from "@singularity/core";
import { DARK_PALETTE_IDS, groundDistance, PALETTE_IDS } from "./palettes.js";
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
  software_engineering_depth: ["lattice", "contour"],
  taste_and_design_philosophy: ["orbit", "numeral"],
  // Hardware and model numbers: a lens and a large numeral. Tech stories never take a Top pick
  // slot, so one leads only a digest that holds nothing else.
  consumer_tech_releases: ["aperture", "numeral"],
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

/** Palettes closer than this in OKLab look alike in a grid, so neighbours should not pair up. */
const SIMILAR_GROUND = 0.28;
/** Weight of a palette that looks like the previous one: not forbidden, only unlikely. */
const SIMILAR_WEIGHT = 0.12;

/**
 * Chooses a cover for a digest. Deterministic from the digest id, never repeats the previous
 * digest's template or palette (nor, when `recent` is given, any of the last few), leans toward the
 * lead category's template, steers away from a palette that looks like the previous one, and draws
 * weekly digests from the dark palette family. Episodes may use any palette: they are inverted.
 */
export function pickCover(input: PickInput): CoverSpec {
  const rng = mulberry32(hash32(`pick:${input.id}`));
  const seed = hash32(`seed:${input.id}`);
  const history = [...(input.previous ? [input.previous] : []), ...(input.recent ?? [])];

  // Anything used in the last few covers is out while enough remain; only the previous is absolute.
  const spread = (candidates: readonly string[], used: ReadonlySet<string>, floor: number) => {
    const fresh = candidates.filter((c) => !used.has(c));
    return fresh.length >= floor ? fresh : candidates;
  };
  const previousOnly = <T extends string>(all: readonly T[], previous?: string): T[] =>
    all.filter((c) => c !== previous);

  const usedTemplates = new Set(history.map((h) => h.template));
  const templates = spread(
    previousOnly(TEMPLATES, input.previous?.template),
    usedTemplates,
    3,
  ) as TemplateId[];
  const template = rng.weighted(templates, (t) => templateWeight(t, input.lead_category));

  const family = input.kind === "weekly" ? DARK_PALETTE_IDS : PALETTE_IDS;
  const usedPalettes = new Set(history.map((h) => h.palette));
  const palettes = spread(previousOnly(family, input.previous?.palette), usedPalettes, 3);
  const pool = palettes.length > 0 ? palettes : PALETTE_IDS;
  const previousPalette = input.previous?.palette;
  const palette = rng.weighted(pool, (id) =>
    previousPalette && groundDistance(id, previousPalette) < SIMILAR_GROUND ? SIMILAR_WEIGHT : 1,
  );

  return { template, palette, seed };
}
