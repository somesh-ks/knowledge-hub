import type { Template, TemplateId } from "../types.js";
import { aperture } from "./aperture.js";
import { band } from "./band.js";
import { contour } from "./contour.js";
import { dither } from "./dither.js";
import { lattice } from "./lattice.js";
import { numeral } from "./numeral.js";
import { orbit } from "./orbit.js";
import { spring } from "./spring.js";

export const TEMPLATE_FNS: Record<TemplateId, Template> = {
  spring,
  dither,
  contour,
  numeral,
  lattice,
  orbit,
  aperture,
  band,
};
/**
 * "standard" covers get the date lockup added by the renderer. "own" covers draw the day numeral as
 * the art, so the renderer adds only the wordmark and month, in the top corners.
 */
export const TEMPLATE_LOCKUP: Record<TemplateId, "standard" | "own"> = {
  spring: "standard",
  dither: "standard",
  contour: "standard",
  numeral: "own",
  lattice: "standard",
  orbit: "standard",
  aperture: "standard",
  band: "standard",
};
export const TEMPLATES = Object.keys(TEMPLATE_FNS) as TemplateId[];
