import type { Template } from "../../types.js";
import { frame, rect } from "./kit.js";

/**
 * Swiss blocks: a 6 by 6 module grid in the top right, filled with a handful of spanning blocks.
 * One hero block in the figure colour, the rest quieter, every gap the same width.
 */
export const modularGrid: Template = (ctx) => {
  const { pal, rng } = ctx;
  const cell = 104;
  const x0 = 1024 - 6 * cell;
  const gap = 10;
  const used = Array.from({ length: 6 }, () => Array<boolean>(6).fill(false));
  const free = (c: number, r: number, w: number, h: number): boolean => {
    if (c + w > 6 || r + h > 6) return false;
    for (let j = r; j < r + h; j += 1)
      for (let i = c; i < c + w; i += 1) if (used[j]?.[i]) return false;
    return true;
  };
  const out: string[] = [];
  const put = (c: number, r: number, w: number, h: number, fill: string): void => {
    for (let j = r; j < r + h; j += 1)
      for (let i = c; i < c + w; i += 1) (used[j] as boolean[])[i] = true;
    // Blocks touching the right or top edge bleed off it.
    const bx = x0 + c * cell + (c === 0 ? gap : gap / 2);
    const by = r * cell + (r === 0 ? 0 : gap / 2);
    const bw = w * cell - (c === 0 ? gap : gap / 2) - (c + w === 6 ? 0 : gap / 2);
    const bh = h * cell - (r === 0 ? 0 : gap / 2) - gap / 2;
    out.push(rect(bx, by, bw, bh, fill));
  };
  const heroC = rng.int(0, 2) * 2;
  const heroR = rng.int(0, 2) * 2;
  put(Math.min(heroC, 3), Math.min(heroR, 3), 3, 3, pal.accent);
  const tones = [pal.shade, pal.field, pal.shade, pal.field, pal.shade];
  let placed = 0;
  for (let tries = 0; tries < 80 && placed < 4; tries += 1) {
    const w = rng.pick([1, 1, 2, 3]);
    const h = rng.pick([1, 2, 2, 3]);
    const c = rng.int(0, 5);
    const r = rng.int(0, 5);
    if (!free(c, r, w, h)) continue;
    put(c, r, w, h, tones[placed] as string);
    placed += 1;
  }
  return frame(ctx, out.join(""));
};
