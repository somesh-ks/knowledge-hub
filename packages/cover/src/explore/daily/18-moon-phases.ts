import type { Template } from "../../types.js";
import { circle, frame, path } from "./kit.js";

/**
 * Five phases of the moon in a row, a quiet disc of shade with the lit part in the figure colour.
 * The row starts at a phase the seed picks, so each day opens the cycle somewhere else.
 */
export const moonPhases: Template = (ctx) => {
  const { pal, rng } = ctx;
  const r = 78;
  const pitch = 176;
  const x0 = 72 + r;
  const cy = rng.range(360, 420);
  const start = rng.int(0, 7);

  /** Lit part of a disc: `f` in [0, 1] of its width, waxing (lit on the right) or waning. */
  const lit = (cx: number, f: number, waxing: boolean): string => {
    if (f <= 0.01) return "";
    if (f >= 0.99) return circle(cx, cy, r, pal.accent);
    const outer = waxing ? 1 : 0;
    const gibbous = f > 0.5;
    const rx = r * Math.abs(1 - 2 * f);
    const inner = gibbous === waxing ? 1 : 0;
    return path(
      `M${cx} ${cy - r}A${r} ${r} 0 0 ${outer} ${cx} ${cy + r}A${rx} ${r} 0 0 ${inner} ${cx} ${cy - r}Z`,
      pal.accent,
    );
  };
  const out: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const cx = x0 + i * pitch;
    const t = ((start + i) % 8) / 8;
    out.push(circle(cx, cy, r, pal.shade));
    out.push(lit(cx, t <= 0.5 ? t * 2 : (1 - t) * 2, t <= 0.5));
  }
  return frame(ctx, out.join(""));
};
