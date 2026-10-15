import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, clipped, pen } from "./common.js";

/** Level pill: A tall pill filled part way, like a sound or battery level. */
export const s10: Template = (ctx) => {
  const { G, A, S, rng } = pen(ctx);
  const w = 270;
  const h = 580;
  const x = CX - w / 2;
  const y = CY - h / 2;
  const level = rng.range(0.42, 0.7);
  const shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}"/>`;
  const fill = clipped(`${ctx.uid}f`, shape, rect(x, y + h * (1 - level), w, h, A));
  return {
    defs: fill.defs,
    body: rect(x, y, w, h, G, w / 2) + fill.body + circle(CX, y + 120, 44, S),
  };
};
