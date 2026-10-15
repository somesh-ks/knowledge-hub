import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, pen, R } from "./common.js";

/** Rising steps: Five blocks climbing, a sun in the tallest. */
export const s15: Template = (ctx) => {
  const { G, A } = pen(ctx);
  const base = CY + R;
  const w = 140;
  const heights = [150, 250, 350, 450, 560];
  let out = "";
  heights.forEach((hgt, i) => {
    out += rect(CX - 350 + i * w, base - hgt, w - 8, hgt, G);
  });
  out += circle(CX - 350 + 4 * w + (w - 8) / 2, base - 450, 46, A);
  return { body: out };
};
