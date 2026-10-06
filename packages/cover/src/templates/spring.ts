import { mixHex } from "../color.js";
import { deg, lerp } from "../math.js";
import { linePath, n, smoothPath, softKnockout } from "../svg.js";
import type { Ctx, Point, Rect, Template } from "../types.js";

/**
 * Spring: the step response of damped springs, drawn as fine strokes. Many dampings fan out from one
 * origin, overshoot a shared target line and settle; one thicker accent curve is the chosen spring.
 */

/** Normalized step response r(t) of a damped spring with damping ratio zeta and frequency omega. */
export function springResponse(zeta: number, omega: number, t: number): number {
  if (t <= 0) return 0;
  if (Math.abs(zeta - 1) < 1e-3) return 1 - (1 + omega * t) * Math.exp(-omega * t);
  if (zeta < 1) {
    const root = Math.sqrt(1 - zeta * zeta);
    const wd = omega * root;
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta / root) * Math.sin(wd * t));
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const wd = omega * root;
  return 1 - Math.exp(-zeta * omega * t) * (Math.cosh(wd * t) + (zeta / root) * Math.sinh(wd * t));
}

type Mode = "fan" | "mirror" | "cascade";

interface Curve {
  points: Point[];
  tone: number;
}

interface Layout {
  mode: Mode;
  curves: Curve[];
  accent: Point[];
  peak: Point | null;
  targets: { y: number; x0: number; x1: number }[];
}

const SAMPLES = 110;

function sampleCurve(
  zeta: number,
  omega: number,
  delay: number,
  x0: number,
  x1: number,
  yBase: number,
  yTarget: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const tau = i / SAMPLES;
    const r = springResponse(zeta, omega, tau - delay);
    points.push({ x: lerp(x0, x1, tau), y: lerp(yBase, yTarget, r) });
  }
  return points;
}

function buildLayout(ctx: Ctx): Layout {
  const { rng, w, h } = ctx;
  const mode = rng.weighted<Mode>(["fan", "mirror", "cascade"], (m) =>
    m === "fan" ? 5 : m === "mirror" ? 2 : 3,
  );
  const x0 = -0.03 * w;
  const x1 = 1.14 * w;
  const omega = rng.range(11, 21);
  const zetaMin = rng.range(0.06, 0.13);
  const zetaMax = rng.range(0.95, 1.5);
  const spread = rng.range(0, 0.45);
  const curves: Curve[] = [];
  const targets: Layout["targets"] = [];
  const zetaAccent = rng.range(0.17, 0.4);
  let accent: Point[] = [];
  let peak: Point | null = null;

  if (mode === "cascade") {
    const count = rng.int(8, 12);
    const step = rng.range(0.07, 0.095) * h;
    const delayStep = rng.range(0.035, 0.055);
    const zeta = rng.range(0.1, 0.22);
    const top = h * rng.range(0.1, 0.18);
    const rise = h * rng.range(0.14, 0.21);
    const accentIndex = rng.int(Math.floor(count * 0.35), Math.floor(count * 0.7));
    for (let i = 0; i < count; i += 1) {
      const yBase = top + step * i + rise;
      const yTarget = yBase - rise;
      const delay = delayStep * i;
      const points = sampleCurve(zeta, omega * 0.8, delay, x0, x1, yBase, yTarget);
      if (i === accentIndex) {
        accent = points;
      } else {
        curves.push({ points, tone: i / (count - 1) });
      }
      targets.push({ y: yTarget, x0, x1 });
    }
    return { mode, curves, accent, peak, targets: targets.filter((_, i) => i === accentIndex) };
  }

  const count = rng.int(24, 40);
  const mirror = mode === "mirror";
  const yBase = mirror ? h * 0.5 : h * rng.range(0.76, 0.86);
  const reach = h * (mirror ? rng.range(0.2, 0.26) : rng.range(0.34, 0.44));
  const yTarget = yBase - reach;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const zeta = lerp(zetaMin, zetaMax, t ** 1.3);
    const wi = omega * (1 + spread * (t - 0.5));
    curves.push({ points: sampleCurve(zeta, wi, 0, x0, x1, yBase, yTarget), tone: t });
    if (mirror) {
      curves.push({ points: sampleCurve(zeta, wi, 0, x0, x1, yBase, yBase + reach), tone: t });
    }
  }
  accent = sampleCurve(zetaAccent, omega, 0, x0, x1, yBase, yTarget);
  const root = Math.sqrt(1 - zetaAccent * zetaAccent);
  const tPeak = Math.PI / (omega * root);
  if (tPeak < 1) {
    peak = {
      x: lerp(x0, x1, tPeak),
      y: lerp(yBase, yTarget, springResponse(zetaAccent, omega, tPeak)),
    };
  }
  targets.push({ y: yTarget, x0, x1 });
  if (mirror) targets.push({ y: yBase + reach, x0, x1 });
  return { mode, curves, accent, peak, targets };
}

interface Orientation {
  quarter: number;
  flip: 1 | -1;
}

function transformPoint(p: Point, ctx: Ctx, o: Orientation, tilt: number): Point {
  const cx = ctx.w / 2;
  const cy = ctx.h / 2;
  let x = p.x - cx;
  let y = (p.y - cy) * o.flip;
  const angle = (o.quarter * Math.PI) / 2 + tilt;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  [x, y] = [x * cos - y * sin, x * sin + y * cos];
  return { x: x + cx, y: y + cy };
}

function inside(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Picks the orientation that keeps ink out of the type zones, with seeded variety among near-ties. */
function chooseOrientation(ctx: Ctx, layout: Layout, tilt: number): Orientation {
  const square = Math.abs(ctx.w - ctx.h) < 1;
  const candidates: Orientation[] = [];
  for (const quarter of square ? [0, 1, 2, 3] : [0, 2]) {
    for (const flip of [1, -1] as const) candidates.push({ quarter, flip });
  }
  // The accent curve and its peak marker are the focal gesture, so a collision with type costs far more.
  const fan = layout.curves.flatMap((c) => c.points.filter((_, i) => i % 5 === 0));
  const accent = layout.accent.filter((_, i) => i % 3 === 0);
  const scored = candidates.map((o) => {
    const hitsType = (p: Point): boolean =>
      ctx.quiet.some((r) => inside(transformPoint(p, ctx, o, tilt), r));
    let hits = fan.filter(hitsType).length + accent.filter(hitsType).length * 6;
    if (layout.peak && hitsType(layout.peak)) hits += 60;
    return { o, hits };
  });
  const best = Math.min(...scored.map((s) => s.hits));
  const pool = scored.filter((s) => s.hits <= best * 1.2 + 2);
  return ctx.rng.pick(pool).o;
}

export const spring: Template = (ctx) => {
  const { rng, pal, u, w, h } = ctx;
  const layout = buildLayout(ctx);
  const tilt = deg(rng.range(-9, 9)) * (rng.chance(0.75) ? 1 : 0);
  const o = chooseOrientation(ctx, layout, tilt);
  const cx = w / 2;
  const cy = h / 2;
  const matrix = `translate(${n(cx)} ${n(cy)}) rotate(${n(o.quarter * 90 + (tilt * 180) / Math.PI, 2)}) scale(1 ${o.flip}) translate(${n(-cx)} ${n(-cy)})`;

  const lineColor = (tone: number): string => mixHex(pal.field, pal.shade, 0.25 + 0.75 * tone);
  const strokes = layout.curves
    .map((curve) => {
      const width = (1.15 + 1.35 * curve.tone) * u;
      return `<path d="${smoothPath(curve.points)}" stroke="${lineColor(curve.tone)}" stroke-width="${n(width, 2)}"/>`;
    })
    .join("");
  const targetColor = mixHex(pal.ground, pal.shade, 0.65);
  const targets = layout.targets
    .map(
      (t) =>
        `<path d="${linePath([
          { x: t.x0, y: t.y },
          { x: t.x1, y: t.y },
        ])}" stroke="${targetColor}" stroke-width="${n(1.5 * u, 2)}" stroke-dasharray="${n(2 * u)} ${n(9 * u)}"/>`,
    )
    .join("");
  const accentPath = smoothPath(layout.accent);
  const peak = layout.peak
    ? `<circle cx="${n(layout.peak.x)}" cy="${n(layout.peak.y)}" r="${n(10 * u)}" fill="${pal.ground}" stroke="${pal.accent}" stroke-width="${n(4 * u)}"/>`
    : "";

  const clipId = `${ctx.uid}k`;
  const body =
    `<g mask="url(#${clipId})"><g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="${matrix}">` +
    targets +
    strokes +
    `<path d="${accentPath}" stroke="${pal.ground}" stroke-width="${n(15 * u, 2)}"/>` +
    `<path d="${accentPath}" stroke="${pal.accent}" stroke-width="${n(6.5 * u, 2)}"/>` +
    peak +
    `</g></g>`;
  return { defs: softKnockout(clipId, ctx.area, ctx.quiet, 26 * ctx.u), body };
};
