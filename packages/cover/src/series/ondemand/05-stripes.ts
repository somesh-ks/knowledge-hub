import { rect } from "../../templates/kit.js";
import type { Template } from "../../types.js";
import { CX, onDisc, pen, R } from "./common.js";

/** Stripe rhythm: Uneven vertical stripes, one loud, clipped round. */
export const s05: Template = (ctx) => {
  const { A, S, rng } = pen(ctx);
  const count = rng.int(6, 8);
  const hero = rng.int(2, count - 3);
  const weights = Array.from(
    { length: count },
    (_, i) => rng.range(0.3, 1) ** 2 * (i === hero ? 2.2 : 1),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let x = CX - R;
  let out = "";
  weights.forEach((w, i) => {
    const width = (2 * R * w) / total;
    if (i === hero) out += rect(x, 0, width, 1024, A);
    else if (i % 2 === 0) out += rect(x, 0, width, 1024, S);
    x += width;
  });
  return onDisc(ctx, "c", out);
};
