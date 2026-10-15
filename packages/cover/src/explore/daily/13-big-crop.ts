import type { Template } from "../../types.js";
import { circle, frame, rect, zone } from "./kit.js";

/**
 * One disc far too big for the frame, cropped by the top and right edges, resting above a shelf of
 * shade. The Blue Note habit: crop hard, keep two colours, leave the air.
 */
export const bigCrop: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const r = rng.range(420, 470);
  const cx = Math.max(left + r, 1024 - rng.range(120, 190));
  const cy = rng.range(250, 330);
  const shelf = Math.max(cy + r + 40, 800);
  return frame(
    ctx,
    circle(cx, cy, r, pal.accent) + rect(left, shelf, 1024 - left, 1024 - shelf, pal.shade),
  );
};
