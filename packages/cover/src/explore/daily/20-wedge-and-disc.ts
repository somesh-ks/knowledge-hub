import type { Template } from "../../types.js";
import { circle, frame, polygon, rect } from "./kit.js";

/**
 * A wedge driven into a disc, with a bar and a block for scale: the vocabulary of Lissitzky's
 * "Beat the Whites with the Red Wedge", taken from agitprop to a calm composition of four marks.
 */
export const wedgeAndDisc: Template = (ctx) => {
  const { pal, rng } = ctx;
  const cx = rng.range(670, 710);
  const cy = rng.range(380, 440);
  const r = rng.range(210, 240);
  const spread = rng.range(110, 150);
  const out = [
    circle(cx, cy, r, pal.accent),
    polygon(
      [
        [cx - r * 0.2, cy + 10],
        [1060, cy - r - 60 - spread],
        [1060, cy - r - 60 + spread * 0.2],
      ],
      pal.shade,
    ),
    rect(440, 730, 90, 90, pal.shade),
    rect(560, 758, 464, 22, pal.accent),
  ];
  return frame(ctx, out.join(""));
};
