import type { Template } from "../../types.js";
import { frame, path, rect, zone } from "./kit.js";

/**
 * A half sun on a horizon bar with its reflection cut into narrowing stripes. Landscape reduced to
 * three marks, in the manner of 1970s travel posters and Japanese sunrise prints.
 */
export const risingSun: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const r = rng.range(215, 255);
  const cx = (left + 1024) / 2 + rng.range(-20, 40);
  const hy = rng.range(540, 590);
  const out: string[] = [];
  out.push(path(`M${cx - r} ${hy}A${r} ${r} 0 0 1 ${cx + r} ${hy}Z`, pal.accent));
  out.push(rect(left, hy, 1024 - left, 52, pal.shade));
  let y = hy + 52 + 34;
  for (let i = 0; i < 4; i += 1) {
    const w = 2 * r * (0.86 - i * 0.2);
    out.push(rect(cx - w / 2, y, w, 22, pal.accent));
    y += 44;
  }
  return frame(ctx, out.join(""));
};
