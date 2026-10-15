import type { Template } from "../../types.js";
import { circle, fill, flat, path, scene, wedge } from "./_kit.js";

export const name = "Week wheel";

/** A wheel cut into seven pale wedges with one pulled out in the figure colour. Signature: the seven wedges. */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const hot = ctx.rng.int(0, 6);
  const cx = 700;
  const cy = 320;
  const r = 240;
  const step = (Math.PI * 2) / 7;
  const seam = ` stroke="${G}" stroke-width="10" stroke-linejoin="round"`;
  const out = [fill(G)];
  for (let i = 0; i < 7; i += 1) {
    if (i !== hot) out.push(path(wedge(cx, cy, r, i * step, (i + 1) * step), M, seam));
  }
  const mid = (hot + 0.5) * step;
  const dx = Math.sin(mid) * 30;
  const dy = -Math.cos(mid) * 30;
  out.push(path(wedge(cx + dx, cy + dy, r, hot * step, (hot + 1) * step), A));
  out.push(circle(cx, cy, 56, G));
  return scene(ctx, out.join(""));
};
