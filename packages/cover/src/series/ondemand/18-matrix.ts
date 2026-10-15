import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, pen } from "./common.js";

/** Dot matrix: A grid of paper dots with one dot in ink. */
export const s18: Template = (ctx) => {
  const { G, I, rng } = pen(ctx);
  const pitch = 170;
  const hero = rng.int(0, 11);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    const x = CX - 1.5 * pitch + (i % 4) * pitch;
    const y = CY - pitch + Math.floor(i / 4) * pitch;
    out += i === hero ? circle(x, y, 72, I) : circle(x, y, 56, G);
  }
  return { body: out };
};
