import type { Template } from "../../types.js";
import { circle, fill, flat, rect, scene } from "./_kit.js";

export const name = "Taped print";

/** A small print held to the wall by two strips of pale tape across its top corners. Signature: the tape. */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const tilt = ctx.rng.pick([34, 40, 46]);
  const tape = (cx: number, cy: number, deg: number): string =>
    `<rect x="${cx - 90}" y="${cy - 26}" width="180" height="52" fill="${M}" transform="rotate(${deg} ${cx} ${cy})"/>`;
  return scene(
    ctx,
    [
      fill(G),
      rect(440, 140, 500, 410, A),
      rect(440, 410, 500, 140, S),
      circle(690, 300, 82, G),
      tape(440, 140, -tilt),
      tape(940, 140, tilt),
    ].join(""),
  );
};
