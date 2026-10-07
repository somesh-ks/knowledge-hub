import { clearRadius } from "../place.js";
import type { Template } from "../types.js";
import { circle, ring } from "./kit.js";

/**
 * Concentric rings around one point: the product's own mark, a ringed dot, grown to cover scale. The
 * centre sits in the upper right so the rings can bleed off the edge while staying clear of the type.
 */
export const orbit: Template = (ctx) => {
  const { w, u, rng, pal } = ctx;
  const cx = w * rng.range(0.58, 0.8);
  const cy = w * rng.range(0.2, 0.4);
  const room = clearRadius(ctx, { x: cx, y: cy }) - 18 * u;
  const outer = Math.min(room, w * rng.range(0.5, 0.64));

  const dot = outer * rng.range(0.07, 0.11);
  const count = rng.int(3, 6);
  const heavy = rng.chance(0.5);
  const curve = rng.range(0.8, 1.25);
  // The ring stroke is a share of the pitch, so heavy rings stay distinct from their neighbours.
  const pitch = (outer - dot * 2) / count;
  const stroke = pitch * (heavy ? rng.range(0.46, 0.58) : rng.range(0.22, 0.34));

  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 1) / count;
    const r = dot * 2 + (outer - dot * 2 - stroke / 2) * t ** curve;
    out.push(ring(cx, cy, r, stroke, i % 2 === 1 && rng.chance(0.5) ? pal.shade : pal.accent));
  }
  out.push(circle(cx, cy, dot, pal.text));
  return { body: out.join("") };
};
