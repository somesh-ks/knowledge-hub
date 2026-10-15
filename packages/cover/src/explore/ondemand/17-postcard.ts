import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, clipped, dome, pen } from "./common.js";

/** Postcard: A landscape card with a half sun and a small hill. */
export const s17: Template = (ctx) => {
  const { G, A, S } = pen(ctx);
  const w = 820;
  const h = 540;
  const x = CX - w / 2;
  const y = CY - h / 2 + 10;
  const k = clipped(
    `${ctx.uid}p`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/>`,
    dome(CX - 120, y + h, 230, A) + circle(CX + 240, y + h + 40, 170, S),
  );
  return { defs: k.defs, body: rect(x, y, w, h, G, 18) + k.body };
};
