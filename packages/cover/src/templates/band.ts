import type { Template } from "../types.js";
import { rect } from "./kit.js";

/**
 * Stacked horizontal bands of unequal height, anchored to the left edge and ragged on the right like
 * a bar chart that lost its axes. The stack stops above the date, so the type keeps flat ground.
 */
export const band: Template = (ctx) => {
  const { w, u, rng, pal, quiet } = ctx;
  const date = quiet[0];
  const mark = quiet[1];
  const top = (mark ? mark.y + mark.h : 0) + 52 * u;
  const bottom = (date ? date.y : w) - 24 * u;

  const count = rng.int(3, 5);
  // Squared weights make the heights properly unequal: one thick band, a few thin ones.
  const weights = Array.from({ length: count }, () => rng.range(0.25, 1) ** 2);
  const total = weights.reduce((sum, v) => sum + v, 0);
  const hero = weights.indexOf(Math.max(...weights));
  const others = [pal.text, pal.shade, pal.field];

  const out: string[] = [];
  let y = top;
  let swatch = rng.int(0, others.length - 1);
  for (let i = 0; i < count; i += 1) {
    const height = ((bottom - top) * (weights[i] as number)) / total;
    const color = i === hero ? pal.accent : (others[swatch % others.length] as string);
    if (i !== hero) swatch += 1;
    const length = rng.chance(0.55) || i === hero ? w : w * rng.range(0.52, 0.9);
    out.push(rect(0, y, length, height, color));
    y += height;
  }
  return { body: out.join("") };
};
