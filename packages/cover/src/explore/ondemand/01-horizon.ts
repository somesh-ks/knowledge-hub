import { circle, rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, onDisc, pen } from "./common.js";

/** Sun on horizon: A disc split by a low horizon with a half sun rising on it. */
export const s01: Template = (ctx) => {
  const { A, S, rng } = pen(ctx);
  const y = CY + 50;
  const x = CX + rng.range(-80, 80);
  return onDisc(ctx, "a", circle(x, y, 150, A) + rect(0, y, 1024, 400, S));
};
