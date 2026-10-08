import { clearRadius } from "../place.js";
import type { Template } from "../types.js";
import { circle } from "./kit.js";

/**
 * A target seen off the right edge: nested discs whose centre sits on or beyond the edge, so only a
 * large arc of each shows. Flat fills alternate figure and text color, outermost first.
 */
export const contour: Template = (ctx) => {
  const { w, u, rng, pal } = ctx;
  const cx = w * rng.range(0.98, 1.16);
  const cy = w * rng.range(0.05, 0.55);
  const outer = Math.min(w * rng.range(0.5, 0.78), clearRadius(ctx, { x: cx, y: cy }) - 24 * u);
  const levels = rng.int(2, 3);
  const colors = [pal.accent, pal.text, pal.accent];
  const out: string[] = [];
  let radius = outer;
  for (let i = 0; i < levels; i += 1) {
    out.push(circle(cx, cy, radius, colors[i] as string));
    radius *= rng.range(0.5, 0.66);
  }
  return { body: out.join("") };
};
