import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, onDisc, pen } from "./common.js";

/** Two hills: A small sun over two overlapping hills, all clipped round. */
export const s02: Template = (ctx) => {
  const { A, S, rng } = pen(ctx);
  const sun = circle(CX + rng.range(-90, 90), CY - 130, 48, A);
  const back = circle(CX - 170, CY + 270, 250, S);
  const front = circle(CX + 150, CY + 340, 290, A);
  return onDisc(ctx, "b", sun + back + front);
};
