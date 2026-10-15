import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, pen } from "./common.js";

/** Diamond and sun: A turned square holding a large disc. */
export const s19: Template = (ctx) => {
  const { G, A, S } = pen(ctx);
  const side = 400;
  return {
    body:
      `<g transform="rotate(45 ${CX} ${CY})">${rect(CX - side / 2, CY - side / 2, side, side, G)}</g>` +
      circle(CX, CY, 165, A) +
      circle(CX + 60, CY - 60, 56, S),
  };
};
