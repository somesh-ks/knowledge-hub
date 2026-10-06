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
export const TEMPLATES = Object.keys(TEMPLATE_FNS) as TemplateId[];
