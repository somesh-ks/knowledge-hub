/**
 * The pure parts of a tap's show (D353): spring curves read from their tokens, channels that tween
 * through beats, the moving mouth, and rings of points a morph flows between. avatarFace.ts plays them.
 */

export type Point = [number, number];

/** The stops of a `linear()` easing token, so a show eases on the same spring the CSS uses. */
export function parseStops(token: string): number[] {
  const inner = /linear\(([^)]*)\)/.exec(token)?.[1];
  const stops = (inner ?? "").split(",").map((stop) => Number.parseFloat(stop));
  return stops.length > 1 && stops.every(Number.isFinite) ? stops : [0, 1];
}

/** The curve's value at progress p (0 to 1), between evenly spaced stops. */
export function easeAt(stops: number[], p: number): number {
  const last = stops.length - 1;
  if (p <= 0) return stops[0] ?? 0;
  if (p >= 1) return stops[last] ?? 1;
  const x = p * last;
  const i = Math.floor(x);
  const from = stops[i] ?? 0;
  return from + ((stops[i + 1] ?? from) - from) * (x - i);
}

/** One move of one channel: from the channel's last value to `to`, starting at `at` ms. */
export interface Beat {
  at: number;
  to: number;
  dur: number;
  ease: number[];
}

/** A channel's value at t: rest before its first beat, each beat easing on from the one before. */
export function channelValue(beats: Beat[], rest: number, t: number): number {
  let from = rest;
  let value = rest;
  for (const beat of beats) {
    if (t < beat.at) break;
    const p = Math.min(1, (t - beat.at) / beat.dur);
    value = from + (beat.to - from) * easeAt(beat.ease, p);
    from = beat.to;
  }
  return value;
}

/**
 * The mouth a show moves, as one closed shape that is a smile at rest (the drawn smile's own curve, a
 * quadratic of depth 13 raised to a cubic), opens into a grin and rounds into an o.
 */
export function mouthPath(
  y: number,
  w: number,
  smile: number,
  open: number,
  round: number,
): string {
  const lerp = (a: number, b: number): number => a + (b - a) * round;
  const width = lerp(w, w * 0.3) * (1 + 0.08 * open);
  // Rounded fully, the handles stand over the corners at 4/3 of the radius: two cubics make a circle.
  const handle = width * lerp(1 / 3, 1);
  const top = lerp((26 / 3) * smile, (-4 / 3) * width);
  const bottom = lerp((26 / 3) * smile + 12 * open, (4 / 3) * width);
  const base = y + 3 * round;
  const f = (n: number): string => n.toFixed(2);
  const [l, r, a, b] = [50 - width, 50 + width, 50 - handle, 50 + handle];
  return `M${f(l)} ${f(base)}C${f(a)} ${f(base + top)} ${f(b)} ${f(base + top)} ${f(r)} ${f(base)}C${f(b)} ${f(base + bottom)} ${f(a)} ${f(base + bottom)} ${f(l)} ${f(base)}Z`;
}

/**
 * A ring of points made ready to morph: running clockwise and starting at its top, so two rings pair
 * point for point and the outline flows instead of twisting through itself.
 */
export function alignRing(points: Point[]): Point[] {
  let area = 0;
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length] ?? [x, y];
    area += x * ny - nx * y;
  });
  const ring = area < 0 ? [...points].reverse() : [...points];
  const cx = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  const cy = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  let start = 0;
  let best = Number.POSITIVE_INFINITY;
  ring.forEach(([x, y], i) => {
    // The point whose direction from the middle is nearest straight up.
    const off = Math.abs(Math.atan2(x - cx, cy - y));
    if (off < best) {
      best = off;
      start = i;
    }
  });
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/** The ring part way from a to b (same length). */
export function lerpRing(a: Point[], b: Point[], t: number): Point[] {
  return a.map(([x, y], i) => {
    const [bx, by] = b[i] ?? [x, y];
    return [x + (bx - x) * t, y + (by - y) * t];
  });
}

/** A ring as a closed path. */
export function ringPath(points: Point[]): string {
  return `${points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}Z`;
}
