import type { Point, Rect } from "./types.js";

let nonFinite = 0;

/** How many non-finite numbers `n` has sanitized. Tests assert this stays at zero. */
export function nonFiniteCount(): number {
  return nonFinite;
}

/** Formats a coordinate: fixed precision, no trailing zeros, never NaN or Infinity. */
export function n(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    nonFinite += 1;
    return "0";
  }
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Polyline as an SVG path. */
export function linePath(points: readonly Point[], closed = false, digits = 1): string {
  if (points.length === 0) return "";
  const parts = points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x, digits)} ${n(p.y, digits)}`);
  return parts.join("") + (closed ? "Z" : "");
}

/** Catmull-Rom spline through points as cubic Beziers; smooth and compact. */
export function smoothPath(points: readonly Point[], closed = false, digits = 1): string {
  const count = points.length;
  if (count < 3) return linePath(points, closed, digits);
  const at = (i: number): Point => {
    const index = closed ? (i + count) % count : Math.min(count - 1, Math.max(0, i));
    return points[index] as Point;
  };
  const first = at(0);
  let d = `M${n(first.x, digits)} ${n(first.y, digits)}`;
  const segments = closed ? count : count - 1;
  for (let i = 0; i < segments; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${n(c1x, digits)} ${n(c1y, digits)} ${n(c2x, digits)} ${n(c2y, digits)} ${n(p2.x, digits)} ${n(p2.y, digits)}`;
  }
  return d + (closed ? "Z" : "");
}

export function rectPath(r: Rect, digits = 1): string {
  return `M${n(r.x, digits)} ${n(r.y, digits)}h${n(r.w, digits)}v${n(r.h, digits)}h${n(-r.w, digits)}Z`;
}

export function pad(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, w: r.w + amount * 2, h: r.h + amount * 2 };
}

/** A clip path covering `area` minus the given rectangles; used to knock type zones out of art. */
export function knockoutClip(id: string, area: Rect, holes: readonly Rect[]): string {
  const outer = rectPath(area);
  const inner = holes.map((r) => rectPath(r)).join("");
  return `<clipPath id="${id}"><path clip-rule="evenodd" d="${outer}${inner}"/></clipPath>`;
}

/** Opacity stops for a smoothstep fade from opaque (offset 0) to clear (offset 1). */
const FADE_STOPS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
  .map((t) => {
    const alpha = 1 - t * t * (3 - 2 * t);
    return `<stop offset="${t}" stop-color="#000" stop-opacity="${n(alpha, 3)}"/>`;
  })
  .join("");

/**
 * A mask that fades art out around the given rectangles instead of cutting it with a hard edge, for
 * line art that should seem to part around the type. Each hole is a nine-slice of flat black and
 * smoothstep gradients, so it needs no blur filter (resvg aborts on a filter inside a mask over
 * large content). `fade` is the half-width of the fade: alpha is one `fade` inside a rectangle's
 * edge and zero one `fade` outside it.
 */
export function softKnockout(id: string, area: Rect, holes: readonly Rect[], fade: number): string {
  const region = `x="${n(area.x)}" y="${n(area.y)}" width="${n(area.w)}" height="${n(area.h)}"`;
  const linear = (name: string, x1: number, y1: number, x2: number, y2: number): string =>
    `<linearGradient id="${id}${name}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${FADE_STOPS}</linearGradient>`;
  const radial = (name: string, cx: number, cy: number): string =>
    `<radialGradient id="${id}${name}" cx="${cx}" cy="${cy}" r="1" fx="${cx}" fy="${cy}">${FADE_STOPS}</radialGradient>`;
  const gradients =
    linear("T", 0, 1, 0, 0) +
    linear("B", 0, 0, 0, 1) +
    linear("L", 1, 0, 0, 0) +
    linear("R", 0, 0, 1, 0) +
    radial("tl", 1, 1) +
    radial("tr", 0, 1) +
    radial("bl", 1, 0) +
    radial("br", 0, 0);
  const piece = (x: number, y: number, w: number, h: number, fill: string): string =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`;
  const slices = holes
    .map((r) => {
      const f = Math.min(fade, r.w / 2, r.h / 2);
      const ref = (name: string): string => `url(#${id}${name})`;
      const right = r.x + r.w;
      const bottom = r.y + r.h;
      return (
        piece(r.x + f, r.y + f, r.w - 2 * f, r.h - 2 * f, "#000") +
        piece(r.x + f, r.y - f, r.w - 2 * f, 2 * f, ref("T")) +
        piece(r.x + f, bottom - f, r.w - 2 * f, 2 * f, ref("B")) +
        piece(r.x - f, r.y + f, 2 * f, r.h - 2 * f, ref("L")) +
        piece(right - f, r.y + f, 2 * f, r.h - 2 * f, ref("R")) +
        piece(r.x - f, r.y - f, 2 * f, 2 * f, ref("tl")) +
        piece(right - f, r.y - f, 2 * f, 2 * f, ref("tr")) +
        piece(r.x - f, bottom - f, 2 * f, 2 * f, ref("bl")) +
        piece(right - f, bottom - f, 2 * f, 2 * f, ref("br"))
      );
    })
    .join("");
  return `${gradients}<mask id="${id}" maskUnits="userSpaceOnUse" ${region}><rect ${region} fill="#fff"/>${slices}</mask>`;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
