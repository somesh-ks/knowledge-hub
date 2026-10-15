import type { Template } from "../../types.js";
import { frame, path } from "./kit.js";

/**
 * Cut-paper leaves fanned from one point at the bottom edge, in the spirit of Matisse's cut-outs:
 * five almond shapes, the tallest in the middle, the outer pair behind.
 */
export const sprout: Template = (ctx) => {
  const { pal, rng } = ctx;
  const px = rng.range(740, 790);
  const py = 1040;
  const leaf = (len: number, wid: number, angle: number, fill: string): string => {
    const d =
      `M0 0C${-wid * 0.95} ${-len * 0.28} ${-wid * 0.55} ${-len * 0.86} 0 ${-len}` +
      `C${wid * 0.55} ${-len * 0.86} ${wid * 0.95} ${-len * 0.28} 0 0Z`;
    return `<g transform="translate(${px} ${py}) rotate(${angle})">${path(d, fill)}</g>`;
  };
  const spread = rng.range(40, 50);
  const out = [
    leaf(rng.range(430, 470), 120, -spread, pal.shade),
    leaf(rng.range(430, 470), 120, spread, pal.shade),
    leaf(rng.range(560, 620), 130, -spread / 2, pal.field),
    leaf(rng.range(560, 620), 130, spread / 2, pal.field),
    leaf(rng.range(780, 860), 150, rng.range(-4, 4), pal.accent),
  ];
  return frame(ctx, out.join(""));
};
