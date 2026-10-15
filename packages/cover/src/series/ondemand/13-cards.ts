import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, pen } from "./common.js";

/** Offset cards: A paper card on an ink card, a sun on the front one. */
export const s13: Template = (ctx) => {
  const { G, A, I } = pen(ctx);
  const w = 430;
  const h = 520;
  return {
    body:
      `<g transform="rotate(-9 ${CX} ${CY})">${rect(CX - w / 2 - 30, CY - h / 2 - 20, w, h, I, 16)}</g>` +
      `<g transform="rotate(6 ${CX} ${CY})">${rect(CX - w / 2 + 40, CY - h / 2 + 10, w, h, G, 16)}${circle(CX + 40, CY - 40, 120, A)}</g>`,
  };
};
