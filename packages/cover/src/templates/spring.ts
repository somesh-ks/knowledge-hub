import type { Template } from "../types.js";
import { polygon } from "./kit.js";

/**
 * A bold diagonal split. The line is pushed right until both pieces of type sit on the ground side,
 * so the cut can be as steep as the seed likes without ever touching the date or wordmark.
 */
export const spring: Template = (ctx) => {
  const { w, u, rng, pal, quiet } = ctx;
  const mode = rng.pick(["split", "pinstripe", "ribbon"] as const);
  const gap = w * rng.range(0.05, 0.09);
  const stripe = w * rng.range(0.02, 0.04);
  // The pinstripe sits on the ground side of the cut, so the type must clear it as well.
  const lead = mode === "pinstripe" ? gap + stripe : 0;

  // x position of the cut at height y, from its top and bottom intercepts.
  let top = w * rng.range(0.42, 0.74);
  let bottom = w * rng.range(0.34, 0.8);
  const at = (y: number): number => top + ((bottom - top) * y) / w;
  const clearance = 26 * u;
  for (const zone of quiet) {
    const need = zone.x + zone.w + clearance + lead;
    const deficit = Math.max(need - at(zone.y), need - at(zone.y + zone.h));
    if (deficit > 0) {
      top += deficit;
      bottom += deficit;
    }
  }

  // A parallelogram between two offsets of the cut, running the full height of the canvas.
  const slab = (from: number, to: number, fill: string): string =>
    polygon(
      [
        [top + from, 0],
        [top + to, 0],
        [bottom + to, w],
        [bottom + from, w],
      ],
      fill,
    );
  const reach = w * 2;
  if (mode === "split") return { body: slab(0, reach, pal.accent) };
  if (mode === "pinstripe") {
    return { body: slab(0, reach, pal.accent) + slab(-gap - stripe, -gap, pal.text) };
  }
  // A diagonal ribbon with a quieter field beyond it.
  const ribbon = w * rng.range(0.22, 0.34);
  return { body: slab(0, reach, pal.shade) + slab(0, ribbon, pal.accent) };
};
