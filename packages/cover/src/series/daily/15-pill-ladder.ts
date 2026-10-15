import type { Template } from "../../types.js";
import { frame, rect, zone } from "./kit.js";

/**
 * Stadium pills of unequal length, flush on the right like progress bars at rest. A soft cousin of
 * the band cover: round ends, a steady beat, one pill in the figure colour.
 */
export const pillLadder: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const rows = 8;
  const height = 62;
  const pitch = 96;
  const top = (1024 - (rows * pitch - (pitch - height))) / 2;
  const right = 972;
  const hero = rng.int(1, rows - 2);
  const out: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const len = i === hero ? right - left : rng.range(190, right - left - 80);
    const fill = i === hero ? pal.accent : i % 2 === 0 ? pal.shade : pal.field;
    out.push(rect(right - len, top + i * pitch, len, height, fill, height / 2));
  }
  return frame(ctx, out.join(""));
};
