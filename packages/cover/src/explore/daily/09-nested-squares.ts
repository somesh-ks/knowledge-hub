import type { Template } from "../../types.js";
import { frame, rect } from "./kit.js";

/**
 * Squares sunk into squares with a heavy bottom margin, after Albers' Homage to the Square: the
 * gestalt is the way each colour changes the one around it. Three squares and the ground.
 */
export const nestedSquares: Template = (ctx) => {
  const { pal, rng } = ctx;
  const quiet = rng.chance(0.5);
  const fills = quiet ? [pal.field, pal.shade, pal.accent] : [pal.shade, pal.accent, pal.ground];
  const sizes = [590, 410, 240];
  const lift = [0, 62, 118];
  const cx = 720;
  const bottom = rng.range(700, 780);
  const out = sizes.map((s, i) =>
    rect(cx - s / 2, bottom - (lift[i] as number) - s, s, s, fills[i] as string),
  );
  return frame(ctx, out.join(""));
};
