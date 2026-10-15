import type { Template } from "../../types.js";
import { CX, CY, dome, pen } from "./common.js";

/** Scallop wave: Rows of half discs facing alternately, a calm wave. */
export const s14: Template = (ctx) => {
  const { G, I } = pen(ctx);
  const r = 58;
  let out = "";
  for (let row = 0; row < 3; row += 1) {
    const y = CY - 150 + row * 150;
    for (let i = 0; i < 6; i += 1) {
      const x = CX - 5 * r + r * 2 * i + (row % 2 === 1 ? r : 0) - r / 2;
      const up = (i + row) % 2 === 0;
      out += dome(x, y, r, up ? G : I, up);
    }
  }
  return { body: out };
};
