import { mixHex } from "../color.js";
import { clamp, deg, lerp } from "../math.js";
import { circleHitsQuiet, lockupCenter } from "../place.js";
import { n, softKnockout } from "../svg.js";
import type { Point, Template } from "../types.js";

/**
 * Orbit: nested rings whose centers drift along a seeded path, so they crowd together on one side
 * and open up on the other. Rings are arcs with rotating gaps, weights vary in rhythm, one ring is
 * the accent and carries a planet.
 */

type ArcMode = "full" | "spiral" | "fragments" | "fade";
type RadiusMode = "linear" | "geometric";

interface Ring {
  center: Point;
  radius: number;
  start: number;
  sweep: number;
  width: number;
  color: string;
}

function arcPath(c: Point, r: number, start: number, sweep: number): string {
  const a0 = start;
  const a1 = start + sweep;
  const x0 = c.x + r * Math.cos(a0);
  const y0 = c.y + r * Math.sin(a0);
  const x1 = c.x + r * Math.cos(a1);
  const y1 = c.y + r * Math.sin(a1);
  const large = sweep > Math.PI ? 1 : 0;
  return `M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${large} 1 ${n(x1)} ${n(y1)}`;
}

export const orbit: Template = (ctx) => {
  const { rng, w, h, u, pal } = ctx;
  const size = Math.min(w, h);
  const count = rng.int(16, 40);
  const arcMode = rng.weighted<ArcMode>(["full", "spiral", "fragments", "fade"], (m) =>
    m === "full" ? 2 : m === "spiral" ? 4 : m === "fragments" ? 3 : 3,
  );
  const radiusMode = rng.weighted<RadiusMode>(["linear", "geometric"], (m) =>
    m === "linear" ? 3 : 2,
  );
  const smallest = size * rng.range(0.025, 0.07);
  const largest = size * rng.range(0.85, 1.4);

  // The tight end of the path sits at the focal point; the open end drifts toward the type zone.
  const from = ctx.focus;
  const lock = lockupCenter(ctx);
  const toward = Math.atan2(lock.y - from.y, lock.x - from.x) + deg(rng.range(-40, 40));
  const drift = (largest - smallest) * rng.range(0.4, 0.88);
  const bend = deg(rng.range(-50, 50));
  const to = { x: from.x + Math.cos(toward) * drift, y: from.y + Math.sin(toward) * drift };
  const mid = {
    x: lerp(from.x, to.x, 0.5) + Math.cos(toward + Math.PI / 2 + bend) * drift * 0.25,
    y: lerp(from.y, to.y, 0.5) + Math.sin(toward + Math.PI / 2 + bend) * drift * 0.25,
  };
  const pathAt = (t: number): Point => ({
    x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * mid.x + t * t * to.x,
    y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * mid.y + t * t * to.y,
  });

  const accentIndex = Math.round((count - 1) * rng.range(0.28, 0.62));
  const keyRings = new Set<number>([accentIndex]);
  const keyCount = rng.int(2, 4);
  while (keyRings.size < keyCount + 1) keyRings.add(rng.int(2, count - 3));
  const spin = deg(rng.range(8, 24)) * rng.sign();
  const startAngle = rng.range(0, Math.PI * 2);
  const baseWidth = rng.range(1.2, 2.2);
  const rings: Ring[] = [];
  const farCorner = Math.max(Math.hypot(w, h), 1);

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const radius =
      radiusMode === "linear"
        ? lerp(smallest, largest, t ** 1.15)
        : smallest * (largest / smallest) ** t;
    const center = pathAt(t);
    const start = startAngle + i * spin;
    let sweep = Math.PI * 2;
    if (arcMode === "spiral")
      sweep = deg(lerp(330, 150, (t * 7) % 1 > 0.5 ? 1 - ((t * 7) % 1) : (t * 7) % 1));
    if (arcMode === "fragments") sweep = deg(rng.range(110, 330));
    if (arcMode === "fade") sweep = deg(lerp(350, 120, t ** 0.8));
    const isAccent = i === accentIndex;
    const isKey = keyRings.has(i);
    if (isAccent) sweep = Math.max(sweep, deg(rng.range(220, 330)));
    const width = (isAccent ? 11 : isKey ? rng.range(5, 8) : baseWidth + rng.range(0, 1.4)) * u;
    const color = isAccent
      ? pal.accent
      : isKey
        ? mixHex(pal.shade, pal.text, pal.tone === "dark" ? 0.15 : 0.3)
        : mixHex(pal.field, pal.shade, 0.25 + 0.75 * t);
    // Skip rings that miss the canvas entirely.
    const reach = Math.hypot(center.x - w / 2, center.y - h / 2);
    if (radius - reach > farCorner / 2 + 4 || radius + reach < 0) continue;
    rings.push({ center, radius, start, sweep: Math.min(sweep, Math.PI * 2), width, color });
  }

  const accent = rings.find((r) => r.color === pal.accent);
  let planet = "";
  if (accent) {
    const planetR = size * rng.range(0.018, 0.03);
    let best: { p: Point; score: number } | null = null;
    for (let k = 0; k < 40; k += 1) {
      const angle = accent.start + accent.sweep * rng.range(0.1, 0.9);
      const p = {
        x: accent.center.x + accent.radius * Math.cos(angle),
        y: accent.center.y + accent.radius * Math.sin(angle),
      };
      const inside =
        p.x > ctx.margin && p.x < w - ctx.margin && p.y > ctx.margin && p.y < h - ctx.margin;
      const clear = !circleHitsQuiet(ctx, p, planetR * 2, 20 * u);
      const score = (inside ? 2 : 0) + (clear ? 2 : 0) + rng.next() * 0.1;
      if (!best || score > best.score) best = { p, score };
    }
    if (best) {
      planet = `<circle cx="${n(best.p.x)}" cy="${n(best.p.y)}" r="${n(planetR + 7 * u)}" fill="${pal.ground}"/><circle cx="${n(best.p.x)}" cy="${n(best.p.y)}" r="${n(planetR)}" fill="${pal.text}"/>`;
    }
  }

  const strokes = rings
    .map((ring) => {
      const attrs = `stroke="${ring.color}" stroke-width="${n(ring.width, 2)}"`;
      if (ring.sweep >= Math.PI * 2 - 0.01) {
        return `<circle cx="${n(ring.center.x)}" cy="${n(ring.center.y)}" r="${n(ring.radius)}" ${attrs}/>`;
      }
      return `<path d="${arcPath(ring.center, ring.radius, ring.start, clamp(ring.sweep, 0.1, Math.PI * 2))}" ${attrs}/>`;
    })
    .join("");

  const clipId = `${ctx.uid}k`;
  return {
    defs: softKnockout(clipId, ctx.area, ctx.quiet, 26 * ctx.u),
    body: `<g mask="url(#${clipId})"><g fill="none">${strokes}${planet}</g></g>`,
  };
};
