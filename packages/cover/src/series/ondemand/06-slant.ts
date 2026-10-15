import { rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, CY, onDisc, pen, R } from "./common.js";

/** Slant bars: Three or four rounded bars on a slant inside the disc. */
export const s06: Template = (ctx) => {
  const { A, S, rng } = pen(ctx);
  const count = rng.int(3, 4);
  const thick = 74;
  const gap = 38;
  const span = count * thick + (count - 1) * gap;
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const y = CY - span / 2 + i * (thick + gap);
    const reach = Math.max(Math.abs(y - CY), Math.abs(y + thick - CY)) + 8;
    const length = 2 * Math.sqrt(R * R - reach * reach) * rng.range(0.6, 0.95);
    const x = CX - length / 2 + rng.range(-40, 40);
    out += rect(x, y, length, thick, i % 2 === 0 ? A : S, thick / 2);
  }
  return onDisc(ctx, "d", `<g transform="rotate(-32 ${CX} ${CY})">${out}</g>`);
};
