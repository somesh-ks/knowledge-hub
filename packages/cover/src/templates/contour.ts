import { mixHex } from "../color.js";
import { clamp, deg } from "../math.js";
import { quietFade } from "../place.js";
import { fbm } from "../prng.js";
import { n, smoothPath, softKnockout } from "../svg.js";
import type { Point, Template } from "../types.js";

/**
 * Contour: topographic lines from seeded noise via marching squares. Index contours are heavier,
 * the summit loop is filled with the accent, and a calm lake of flat ground keeps the date clear.
 */

export interface Polyline {
  points: Point[];
  closed: boolean;
}

/**
 * Marching squares over a (cols + 1) by (rows + 1) sample grid. Returns chained polylines at
 * `level` in grid coordinates. Crossings are interpolated, so lines are smooth at any resolution.
 */
export function marchingSquares(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  level: number,
): Polyline[] {
  const stride = cols + 1;
  const at = (x: number, y: number): number => values[y * stride + x] as number;
  // Edge id: (y * stride + x) * 2 + direction, direction 0 = horizontal edge, 1 = vertical edge.
  const edgeId = (x: number, y: number, vertical: 0 | 1): number => (y * stride + x) * 2 + vertical;
  const crossing = new Map<number, Point>();
  const crossingAt = (id: number, ax: number, ay: number, bx: number, by: number): void => {
    if (crossing.has(id)) return;
    const va = at(ax, ay);
    const vb = at(bx, by);
    const t = va === vb ? 0.5 : clamp((level - va) / (vb - va), 0, 1);
    crossing.set(id, { x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
  };

  const segments: [number, number][] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const tl = at(x, y) > level;
      const tr = at(x + 1, y) > level;
      const br = at(x + 1, y + 1) > level;
      const bl = at(x, y + 1) > level;
      const index = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
      if (index === 0 || index === 15) continue;
      const top = edgeId(x, y, 0);
      const bottom = edgeId(x, y + 1, 0);
      const left = edgeId(x, y, 1);
      const right = edgeId(x + 1, y, 1);
      crossingAt(top, x, y, x + 1, y);
      crossingAt(bottom, x, y + 1, x + 1, y + 1);
      crossingAt(left, x, y, x, y + 1);
      crossingAt(right, x + 1, y, x + 1, y + 1);
      const center = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > level;
      switch (index) {
        case 1:
        case 14:
          segments.push([left, top]);
          break;
        case 2:
        case 13:
          segments.push([top, right]);
          break;
        case 3:
        case 12:
          segments.push([left, right]);
          break;
        case 4:
        case 11:
          segments.push([right, bottom]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([left, bottom]);
          break;
        case 5:
          if (center) segments.push([left, bottom], [top, right]);
          else segments.push([left, top], [right, bottom]);
          break;
        case 10:
          if (center) segments.push([left, top], [right, bottom]);
          else segments.push([top, right], [left, bottom]);
          break;
        default:
          break;
      }
    }
  }

  const byEdge = new Map<number, number[]>();
  segments.forEach(([a, b], i) => {
    for (const id of [a, b]) {
      const list = byEdge.get(id);
      if (list) list.push(i);
      else byEdge.set(id, [i]);
    }
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const other = (segment: [number, number], id: number): number =>
    segment[0] === id ? segment[1] : segment[0];

  const lines: Polyline[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    used[start] = true;
    const first = segments[start] as [number, number];
    const chain: number[] = [first[0], first[1]];
    const extend = (forward: boolean): void => {
      for (;;) {
        const tip = forward ? (chain[chain.length - 1] as number) : (chain[0] as number);
        const next = (byEdge.get(tip) ?? []).find((s) => !used[s]);
        if (next === undefined) return;
        used[next] = true;
        const id = other(segments[next] as [number, number], tip);
        if (forward) chain.push(id);
        else chain.unshift(id);
      }
    };
    extend(true);
    extend(false);
    const closed = chain.length > 2 && chain[0] === chain[chain.length - 1];
    const ids = closed ? chain.slice(0, -1) : chain;
    lines.push({ points: ids.map((id) => crossing.get(id) as Point), closed });
  }
  return lines;
}

function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export const contour: Template = (ctx) => {
  const { rng, w, h, u, pal, seed } = ctx;
  const size = Math.min(w, h);
  const cols = Math.round(w / (9 * u));
  const rows = Math.round(h / (9 * u));
  const stepX = w / cols;
  const stepY = h / rows;
  const levels = rng.chance(0.25) ? rng.int(34, 48) : rng.int(13, 26);
  const indexEvery = rng.pick([4, 5, 5, 6]);

  // Terrain: stretched, rotated, domain-warped noise plus a few seeded peaks.
  const freq = rng.range(1.1, 2.6);
  const stretch = rng.chance(0.4) ? rng.range(1.8, 3.4) : 1;
  const angle = deg(rng.range(0, 180));
  const warpFreq = rng.range(0.8, 1.8);
  const warpAmount = rng.range(0.15, 0.55);
  const offset = { x: rng.range(0, 50), y: rng.range(0, 50) };
  const peakCount = rng.int(0, 3);
  const peaks = Array.from({ length: peakCount }, (_, i) => ({
    x: i === 0 ? ctx.focus.x : rng.range(0.1, 0.9) * w,
    y: i === 0 ? ctx.focus.y : rng.range(0.1, 0.9) * h,
    amp: rng.range(0.5, 1.2),
    sigma: rng.range(0.1, 0.22) * size,
  }));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const raw = new Float32Array((cols + 1) * (rows + 1));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const x = i * stepX;
      const y = j * stepY;
      const nx = x / size;
      const ny = y / size;
      const wx = (fbm(nx * warpFreq + 31, ny * warpFreq + 7, seed + 11, 2) - 0.5) * warpAmount;
      const wy = (fbm(nx * warpFreq + 5, ny * warpFreq + 53, seed + 23, 2) - 0.5) * warpAmount;
      const px = (nx + wx) * freq;
      const py = (ny + wy) * freq;
      const rx = (px * cos - py * sin) / stretch;
      const ry = px * sin + py * cos;
      let v = fbm(rx + offset.x, ry + offset.y, seed, 4);
      for (const p of peaks) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        v += p.amp * Math.exp(-d2 / (2 * p.sigma ** 2));
      }
      raw[j * (cols + 1) + i] = v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  // Normalize, then flatten toward a plateau that sits between two levels near the type zones.
  const plateau = (Math.floor(levels * rng.range(0.28, 0.5)) + 0.5) / levels;
  const clearing = [210 * u, 260 * u];
  const grid = new Float32Array(raw.length);
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const k = j * (cols + 1) + i;
      const norm = ((raw[k] as number) - min) / (max - min || 1);
      const wobble =
        (fbm(((i * stepX) / size) * 2.2 + 90, ((j * stepY) / size) * 2.2 + 40, seed + 5, 2) - 0.5) *
        260 *
        u;
      const fade = quietFade(ctx, { x: i * stepX, y: j * stepY }, clearing, wobble);
      grid[k] = norm * fade + plateau * (1 - fade);
    }
  }

  const toCanvas = (p: Point): Point => ({ x: p.x * stepX, y: p.y * stepY });
  const index = (k: number): boolean => k % indexEvery === 0;
  const major = mixHex(pal.shade, pal.text, pal.tone === "dark" ? 0.2 : 0.4);

  let summit: { points: Point[]; area: number; level: number } | null = null;
  const strokes: string[] = [];
  for (let k = 1; k < levels; k += 1) {
    const level = k / levels;
    for (const line of marchingSquares(grid, cols, rows, level)) {
      if (line.points.length < 4) continue;
      const pts = line.points.map(toCanvas);
      if (line.closed) {
        const area = polygonArea(pts);
        if (
          area > 3200 * u * u &&
          (!summit || level > summit.level || (level === summit.level && area > summit.area))
        ) {
          summit = { points: pts, area, level };
        }
      }
      const heavy = index(k);
      const tone = heavy ? major : mixHex(pal.ground, pal.shade, 0.5 + 0.4 * level);
      strokes.push(
        `<path d="${smoothPath(pts, line.closed)}" stroke="${tone}" stroke-width="${n((heavy ? 2.8 : 1.5) * u, 2)}"/>`,
      );
    }
  }

  const clipId = `${ctx.uid}k`;
  const accent = summit
    ? `<path d="${smoothPath(summit.points, true)}" fill="${pal.accent}"/>`
    : "";
  return {
    defs: softKnockout(clipId, ctx.area, ctx.quiet, 26 * ctx.u),
    body:
      `<g mask="url(#${clipId})"><g fill="none" stroke-linejoin="round" stroke-linecap="round">` +
      accent +
      strokes.join("") +
      `</g></g>`,
  };
};
