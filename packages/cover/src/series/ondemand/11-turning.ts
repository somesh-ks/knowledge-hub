import { n } from "../../svg.js";
import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, P, pen } from "./common.js";

/** Turning halves: Three discs, each holding a half that turns. */
export const s11: Template = (ctx) => {
  const { G, A, rng } = pen(ctx);
  const r = 138;
  const xs = [CX - 310, CX, CX + 310];
  const turns = rng.int(0, 3);
  let out = "";
  xs.forEach((x, i) => {
    out += circle(x, CY, r, G);
    const a = ((turns + i) % 4) * 90;
    out += `<g transform="rotate(${a} ${x} ${CY})">${P(`M${n(x - r)} ${n(CY)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(CY)}Z`, A)}</g>`;
  });
  return { body: out };
};
