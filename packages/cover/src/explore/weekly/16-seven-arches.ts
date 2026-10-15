import type { Template } from "../../types.js";
import { fill, flat, path, scene } from "./_kit.js";

export const name = "Seven arches";

/** Seven concentric bands, a rainbow for the seven days, standing on a flat base. Signature: the arches. */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const cycle = ctx.rng.chance(0.5) ? [M, A, S] : [M, S, A];
  const cx = 620;
  const base = 556;
  const out = [fill(G)];
  for (let k = 0; k < 7; k += 1) {
    const r = 360 - k * 40;
    out.push(path(`M${cx - r} ${base}A${r} ${r} 0 0 1 ${cx + r} ${base}Z`, cycle[k % 3] as string));
  }
  out.push(path(`M${cx - 80} ${base}A80 80 0 0 1 ${cx + 80} ${base}Z`, G));
  return scene(ctx, out.join(""));
};
