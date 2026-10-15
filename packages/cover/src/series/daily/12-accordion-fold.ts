import type { Template } from "../../types.js";
import { frame, tri, zone } from "./kit.js";

/**
 * A strip of paper folded like an accordion: each fold splits a panel into a light and a dark
 * facet, so the ribbon turns without a single shadow being drawn. Origami by flat triangles.
 */
export const accordionFold: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const count = 6;
  const step = (1024 - left) / (count - 1);
  const drop = rng.range(70, 100);
  const high = rng.range(150, 230);
  const depth = rng.range(300, 360);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const xa = left + i * step;
    const xb = xa + step;
    const even = i % 2 === 0;
    const ya = high + (even ? 0 : drop);
    const yb = high + (even ? drop : 0);
    out.push(tri([xa, ya], [xb, yb], [xa, ya + depth], even ? pal.accent : pal.shade));
    out.push(tri([xb, yb], [xb, yb + depth], [xa, ya + depth], even ? pal.shade : pal.accent));
  }
  return frame(ctx, out.join(""));
};
