import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, lens, pen } from "./common.js";

/** Ink overlap: Two paper discs on the matte; where they cross, ink. */
export const s07: Template = (ctx) => {
  const { G, S } = pen(ctx);
  const d = 125;
  return {
    body: circle(CX - d, CY, 200, G) + circle(CX + d, CY, 200, G) + lens(CX, CY, 200, d, S),
  };
};
