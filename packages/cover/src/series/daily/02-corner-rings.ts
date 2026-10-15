import type { Template } from "../../types.js";
import { circle, frame } from "./kit.js";

/**
 * Concentric quarter discs growing out of one corner, the last one cut back to ground like a bored
 * hole. A Müller-Brockmann concert poster reduced to its circle.
 */
export const cornerRings: Template = (ctx) => {
  const { pal, rng } = ctx;
  const top = rng.chance(0.5);
  const cy = top ? 0 : 1024;
  const k = rng.range(0.92, 1.02);
  const radii = [620, 450, 290, 140].map((r) => r * k);
  const fills = [pal.field, pal.shade, pal.accent, pal.ground];
  const out = radii.map((r, i) => circle(1024, cy, r, fills[i] as string));
  return frame(ctx, out.join(""));
};
