import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, clipped, dome, pen } from "./common.js";

/** Four panes: Four panes: a disc, a corner, a dome and a blank. */
export const s12: Template = (ctx) => {
  const { G, A, S } = pen(ctx);
  const s = 262;
  const gap = 28;
  const x0 = CX - s - gap / 2;
  const y0 = CY - s - gap / 2;
  const a = { x: x0, y: y0 };
  const b = { x: x0 + s + gap, y: y0 };
  const c = { x: x0, y: y0 + s + gap };
  const d = { x: x0 + s + gap, y: y0 + s + gap };
  const k = clipped(
    `${ctx.uid}g`,
    `<rect x="${b.x}" y="${b.y}" width="${s}" height="${s}" rx="14"/>`,
    circle(b.x, b.y + s, s * 0.8, A),
  );
  return {
    defs: k.defs,
    body:
      rect(a.x, a.y, s, s, G, 14) +
      circle(a.x + s / 2, a.y + s / 2, 92, A) +
      rect(b.x, b.y, s, s, G, 14) +
      k.body +
      rect(c.x, c.y, s, s, G, 14) +
      dome(c.x + s / 2, c.y + s - 50, 100, S) +
      rect(d.x, d.y, s, s, G, 14),
  };
};
