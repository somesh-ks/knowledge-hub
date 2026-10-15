import type { Template } from "../../types.js";
import { fill, flat, polygon, scene } from "./_kit.js";

export const name = "Accordion ribbon";

/**
 * A strip of paper folded into seven panels, lit and shaded in turn, one panel in the figure colour.
 * Weekly signature: the zigzag ribbon with seven folds.
 */
export const weekly: Template = (ctx) => {
  const { G, S, A, M } = flat(ctx);
  const hot = ctx.rng.int(0, 6);
  const out = [fill(G)];
  const step = 1024 / 7;
  const top = (k: number): number => (k % 2 === 0 ? 226 : 290);
  for (let i = 0; i < 7; i += 1) {
    out.push(
      polygon(
        [
          [i * step, top(i)],
          [(i + 1) * step + 0.5, top(i + 1)],
          [(i + 1) * step + 0.5, top(i + 1) + 200],
          [i * step, top(i) + 200],
        ],
        i === hot ? A : i % 2 ? S : M,
      ),
    );
  }
  return scene(ctx, out.join(""));
};
