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

export function rectPath(r: Rect, digits = 1): string {
  return `M${n(r.x, digits)} ${n(r.y, digits)}h${n(r.w, digits)}v${n(r.h, digits)}h${n(-r.w, digits)}Z`;
}

export function pad(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, w: r.w + amount * 2, h: r.h + amount * 2 };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
