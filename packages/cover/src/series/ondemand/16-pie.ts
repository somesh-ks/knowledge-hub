import { n } from "../../svg.js";
import { circle } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, P, pen, R } from "./common.js";

/** Two slices: A donut with an accent slice and a shade slice. */
export const s16: Template = (ctx) => {
  const { G, A, S, M, rng } = pen(ctx);
  const t1 = rng.range(0.5, 0.68) * Math.PI * 2;
  const t2 = t1 + 0.22 * Math.PI * 2;
  const r = 240;
  const pt = (t: number) => `${n(CX + r * Math.sin(t))} ${n(CY - r * Math.cos(t))}`;
  const slice = (a: number, b: number, fill: string) =>
    P(`M${CX} ${CY}L${pt(a)}A${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${pt(b)}Z`, fill);
  return {
    body: circle(CX, CY, R, G) + slice(0, t1, A) + slice(t1, t2, S) + circle(CX, CY, 62, M),
  };
};
