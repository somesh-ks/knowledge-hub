import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, pen } from "./common.js";

/** Record sleeve: A square sleeve holding a disc with a spindle hole. */
export const s04: Template = (ctx) => {
  const { G, A, M } = pen(ctx);
  const side = 540;
  return {
    body:
      rect(CX - side / 2, CY - side / 2, side, side, G, 18) +
      circle(CX, CY, 204, A) +
      circle(CX, CY, 30, M),
  };
};
