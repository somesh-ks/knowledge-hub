/**
 * Generated album-style covers for Singularity briefings. Every cover is a pure function of its spec and
 * date, so the same digest always yields the same bytes. See docs/plan/build-plan.md section 8.11.
 */

export { coverColors } from "./context.js";
export { getPalette, PALETTE_IDS, paletteAccent } from "./palettes.js";
export { pickCover } from "./pick.js";
export { renderCoverPng, renderCoverSvg, renderSocialPng, renderSocialSvg } from "./render.js";
export { TEMPLATES } from "./templates/index.js";
export { topicArt, topicInitial } from "./topicArt.js";
export type { CoverMeta, CoverSpec, PickInput } from "./types.js";
