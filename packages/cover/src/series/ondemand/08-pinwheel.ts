import { n } from "../../svg.js";
import type { Template } from "../../types.js";
import { CX, CY, onDisc, P, pen } from "./common.js";

/** Quarter pinwheel: Four quarter discs turned like a pinwheel in a disc. */
export const s08: Template = (ctx) => {
  const { A, S } = pen(ctx);
  const h = 175;
  const q = (cx: number, cy: number, dx: number, dy: number, fill: string) =>
    P(
      `M${n(cx)} ${n(cy)}L${n(cx + dx * h)} ${n(cy)}A${n(h)} ${n(h)} 0 0 ${dx * dy > 0 ? 1 : 0} ${n(cx)} ${n(cy + dy * h)}Z`,
      fill,
    );
  const out =
    q(CX, CY - h, -1, 1, A) +
    q(CX + h, CY, -1, -1, S) +
    q(CX, CY + h, 1, -1, A) +
    q(CX - h, CY, 1, 1, S);
  return onDisc(ctx, "e", out);
};
