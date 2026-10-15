import type { Template } from "../../types.js";
import { frame, path } from "./kit.js";

/**
 * Three arches nested like a doorway seen straight on, standing on the bottom edge: figure, shade,
 * then ground as the opening. Mid-century architecture drawing, one gesture.
 */
export const tripleArch: Template = (ctx) => {
  const { pal, rng } = ctx;
  const cx = rng.range(700, 740);
  const top = rng.range(150, 220);
  const arch = (w: number, y: number, fill: string): string => {
    const r = w / 2;
    return path(`M${cx - r} 1030V${y + r}A${r} ${r} 0 0 1 ${cx + r} ${y + r}V1030Z`, fill);
  };
  const out = [
    arch(540, top, pal.accent),
    arch(370, top + 120, pal.shade),
    arch(200, top + 240, pal.ground),
  ];
  return frame(ctx, out.join(""));
};
