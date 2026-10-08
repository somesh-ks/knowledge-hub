import { clearRadius } from "../place.js";
import { n } from "../svg.js";
import type { Template } from "../types.js";
import { circle } from "./kit.js";

/**
 * Two overlapping discs and the lens where they cross, each in its own flat color. The lens is the
 * second disc clipped to the first, so the overlap is exact rather than a blend.
 */
export const aperture: Template = (ctx) => {
  const { w, u, rng, pal, uid } = ctx;
  const gap = 20 * u;
  const centre = { x: w * rng.range(0.56, 0.76), y: w * rng.range(0.26, 0.46) };
  const angle = rng.range(0, Math.PI);
  const wantA = w * rng.range(0.2, 0.3);
  const wantB = w * rng.range(0.14, 0.26);
  const spread = (wantA + wantB) * rng.range(0.62, 0.82);
  const dx = Math.cos(angle) * spread;
  const dy = Math.sin(angle) * spread;
  const a = {
    x: centre.x - dx * (wantB / (wantA + wantB)),
    y: centre.y - dy * (wantB / (wantA + wantB)),
  };
  const b = { x: a.x + dx, y: a.y + dy };
  const ra = Math.max(60 * u, Math.min(wantA, clearRadius(ctx, a) - gap));
  const rb = Math.max(60 * u, Math.min(wantB, clearRadius(ctx, b) - gap));

  const clip = `${uid}a`;
  return {
    defs: `<clipPath id="${clip}"><circle cx="${n(a.x)}" cy="${n(a.y)}" r="${n(ra)}"/></clipPath>`,
    body:
      circle(a.x, a.y, ra, pal.accent) +
      circle(b.x, b.y, rb, pal.shade) +
      circle(b.x, b.y, rb, pal.text, ` clip-path="url(#${clip})"`),
  };
};
