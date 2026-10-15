import { deg } from "../../math.js";
import type { Template } from "../../types.js";
import { frame, path } from "./kit.js";

/**
 * Alternating wedges fanned from a corner, the gaps left as ground. A folding fan, a rising-sun
 * flag and a Swiss clock face agree on this one form.
 */
export const cornerFan: Template = (ctx) => {
  const { pal, rng } = ctx;
  const top = rng.chance(0.4);
  const ox = 1030;
  const oy = top ? -6 : 1030;
  const radius = rng.range(585, 625);
  const slices = 9;
  const from = top ? 90 : 180;
  const span = 90 / slices;
  const out: string[] = [];
  for (let i = 0; i < slices; i += 2) {
    const a = deg(from + i * span);
    const b = deg(from + (i + 1) * span);
    const d =
      `M${ox} ${oy}L${ox + radius * Math.cos(a)} ${oy + radius * Math.sin(a)}` +
      `A${radius} ${radius} 0 0 1 ${ox + radius * Math.cos(b)} ${oy + radius * Math.sin(b)}Z`;
    out.push(path(d, i % 4 === 0 ? pal.accent : pal.shade));
  }
  return frame(ctx, out.join(""));
};
