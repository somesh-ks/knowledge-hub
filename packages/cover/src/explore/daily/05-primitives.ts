import type { Template } from "../../types.js";
import { circle, frame, rect, tri } from "./kit.js";

/**
 * The Bauhaus alphabet: circle, square, triangle, stacked in one column with equal gaps. The seed
 * decides their order, which colour each takes and whether the column hugs the left or right.
 */
export const primitives: Template = (ctx) => {
  const { pal, rng } = ctx;
  const size = 288;
  const gap = 40;
  const x0 = rng.chance(0.5) ? 470 : 1024 - size - 70;
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const fills = rng.chance(0.5)
    ? [pal.accent, pal.shade, pal.field]
    : [pal.shade, pal.accent, pal.field];
  const total = size * 3 + gap * 2;
  const top = (1024 - total) / 2;
  const out = order.map((kind, slot) => {
    const y = top + slot * (size + gap);
    const fill = fills[slot] as string;
    if (kind === 0) return circle(x0 + size / 2, y + size / 2, size / 2, fill);
    if (kind === 1) return rect(x0, y, size, size, fill);
    return tri([x0, y + size], [x0 + size, y + size], [x0 + size / 2, y], fill);
  });
  return frame(ctx, out.join(""));
};
