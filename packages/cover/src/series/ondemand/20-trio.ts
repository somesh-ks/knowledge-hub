import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, lens, pen } from "./common.js";

/** Three rings: Three overlapping discs with the overlaps picked out. */
export const s20: Template = (ctx) => {
  const { G, A } = pen(ctx);
  const d = 195;
  const r = 170;
  return {
    body:
      circle(CX - d, CY, r, G) +
      circle(CX, CY, r, G) +
      circle(CX + d, CY, r, G) +
      lens(CX - d / 2, CY, r, d / 2, A) +
      lens(CX + d / 2, CY, r, d / 2, A),
  };
};
