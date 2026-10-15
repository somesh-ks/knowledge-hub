import type { Template } from "../../types.js";
import { frame, polygon, zone } from "./kit.js";

type Pt = readonly [number, number];

/** The seven tangram pieces on a 4 by 4 square, as vertex lists. */
const PIECES: readonly (readonly Pt[])[] = [
  [
    [0, 0],
    [4, 0],
    [2, 2],
  ],
  [
    [0, 0],
    [2, 2],
    [0, 4],
  ],
  [
    [4, 0],
    [4, 2],
    [3, 1],
  ],
  [
    [4, 2],
    [4, 4],
    [2, 4],
  ],
  [
    [2, 2],
    [3, 3],
    [1, 3],
  ],
  [
    [3, 1],
    [4, 2],
    [3, 3],
    [2, 2],
  ],
  [
    [1, 3],
    [3, 3],
    [2, 4],
    [0, 4],
  ],
];

/**
 * The seven-piece Chinese puzzle laid out as its own starting square, each piece drawn a hair apart.
 * Seven shapes, three tones, one square: the cover is the moment before the puzzle is played.
 */
export const tangram: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const unit = Math.min(138, (1024 - left - 50) / 4);
  const x0 = 1024 - 4 * unit - 40;
  const y0 = rng.range(100, 200);
  const tones = [pal.accent, pal.shade, pal.field];
  const offset = rng.int(0, 2);
  const tone = [0, 1, 1, 0, 2, 0, 1].map((t) => tones[(t + offset) % 3] as string);
  const out = PIECES.map((piece, i) => {
    const cx = piece.reduce((s, p) => s + p[0], 0) / piece.length;
    const cy = piece.reduce((s, p) => s + p[1], 0) / piece.length;
    const pts = piece.map(([x, y]) => {
      const k = 1 - 7 / unit / Math.hypot(x - cx, y - cy);
      return [x0 + (cx + (x - cx) * k) * unit, y0 + (cy + (y - cy) * k) * unit] as const;
    });
    return polygon(pts, tone[i] as string);
  });
  return frame(ctx, out.join(""));
};
