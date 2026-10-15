import type { Template } from "../../types.js";
import { CX, CY, dome, pen } from "./common.js";

/** Nested domes: Half discs inside half discs on a flat base. */
export const s09: Template = (ctx) => {
  const { G, A, S, M } = pen(ctx);
  const y = CY + 250;
  return {
    body: dome(CX, y, 330, G) + dome(CX, y, 240, A) + dome(CX, y, 150, S) + dome(CX, y, 70, M),
  };
};
