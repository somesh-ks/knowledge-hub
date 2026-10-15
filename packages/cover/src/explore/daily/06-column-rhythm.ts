import type { Template } from "../../types.js";
import { frame, rect, zone } from "./kit.js";

/**
 * Columns standing on the bottom edge like a skyline or a level meter: equal width, equal gap,
 * heights that climb and fall. The tallest takes the figure colour, the rest stay quiet.
 */
export const columnRhythm: Template = (ctx) => {
  const { pal, rng } = ctx;
  const { left } = zone(ctx);
  const width = 54;
  const gap = 16;
  const count = Math.floor((1024 - left + gap) / (width + gap));
  const start = 1024 - count * (width + gap) + gap;
  const heights: number[] = [];
  let h = rng.range(300, 600);
  for (let i = 0; i < count; i += 1) {
    h = Math.min(920, Math.max(180, h + rng.range(-210, 210)));
    heights.push(h);
  }
  const hero = heights.indexOf(Math.max(...heights));
  const out = heights.map((height, i) =>
    rect(
      start + i * (width + gap),
      1024 - height,
      width,
      height + 4,
      i === hero ? pal.accent : i % 3 === 0 ? pal.field : pal.shade,
    ),
  );
  return frame(ctx, out.join(""));
};
