/**
 * Generated album-style covers for Singularity briefings. Every cover is a pure function of its spec and
 * date, so the same digest always yields the same bytes. See `git show 91bc533:docs/plan/build-plan.md`, section 8.11.
 */

export { coverColors } from "./context.js";
export { FONT_FILE_BASENAMES, setFontDirectory } from "./fonts.js";
export { GLYPH_SHEET_PATH, glyphSheet } from "./glyphs.js";
export { COVER_SLOTS, coverCentre, renderLiveCoverSvg } from "./live.js";
export { COVER_MODES, type CoverMode } from "./mode.js";
export { getPalette, PALETTE_IDS, paletteAccent } from "./palettes.js";
export { pickCover } from "./pick.js";
export { renderCoverPng, renderCoverSvg, renderSocialPng, renderSocialSvg } from "./render.js";
export {
  hueCentre,
  restyleHex,
  STYLE_RULES,
  type StyleRule,
  styleColour,
  styleHex,
} from "./style.js";
export { coverSwatches, type Swatch } from "./swatches.js";
export { TEMPLATES } from "./templates/index.js";
export { topicArt, topicInitial } from "./topicArt.js";
export type { CoverMeta, CoverSpec, PickInput } from "./types.js";
