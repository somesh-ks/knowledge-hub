import { mixHex } from "../color.js";
import { deg, lerp } from "../math.js";
import { clearOfQuiet } from "../place.js";
import { linePath, n, smoothPath, softKnockout } from "../svg.js";
import type { Point, Rect, Template } from "../types.js";

/**
 * Lattice: a square or triangular grid bent by a seeded lens, with a few cells lit. The grid is
 * regular where the type sits and bends toward the focal point, so the distortion is the gesture.
 */

type Kind = "square" | "triangle";

interface Lens {
  center: Point;
  sigma: number;
  /** Positive magnifies the cells at the center, negative pinches them. */
  strength: number;
}

type Warp = (p: Point) => Point;

function makeWarp(lenses: readonly Lens[]): Warp {
  return (p) => {
    let q = p;
    for (const lens of lenses) {
      const dx = q.x - lens.center.x;
      const dy = q.y - lens.center.y;
      const falloff = Math.exp(-(dx * dx + dy * dy) / (2 * lens.sigma ** 2));
      const factor = 1 + lens.strength * falloff;
      q = { x: lens.center.x + dx * factor, y: lens.center.y + dy * factor };
    }
    return q;
  };
}

/** Samples the straight segment a to b into warped points, so curved lines stay smooth. */
function sampleSegment(a: Point, b: Point, warp: Warp, step: number): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(2, Math.ceil(length / step));
  return Array.from({ length: count + 1 }, (_, i) =>
    warp({ x: lerp(a.x, b.x, i / count), y: lerp(a.y, b.y, i / count) }),
  );
}

/** Warped outline of a polygon, each edge sampled. */
function warpedPolygon(corners: readonly Point[], warp: Warp, step: number): Point[] {
  const out: Point[] = [];
  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % corners.length] as Point;
    out.push(...sampleSegment(corner, next, warp, step).slice(0, -1));
  });
  return out;
}

/** Splits a polyline into the runs that lie inside `bounds`, so far-off geometry is never emitted. */
function inBoundsRuns(points: readonly Point[], bounds: Rect): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    const inside =
      p.x >= bounds.x &&
      p.x <= bounds.x + bounds.w &&
      p.y >= bounds.y &&
      p.y <= bounds.y + bounds.h;
    if (inside) {
      run.push(p);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

interface Cell {
  corners: Point[];
  center: Point;
}

export const lattice: Template = (ctx) => {
  const { rng, w, h, u, pal } = ctx;
  const size = Math.min(w, h);
  const kind = rng.weighted<Kind>(["square", "triangle"], (k) => (k === "square" ? 5 : 4));
  const cell = size / (kind === "square" ? rng.int(7, 12) : rng.int(8, 13));
  const rowHeight = (cell * Math.sqrt(3)) / 2;
  const origin = { x: rng.range(-1, 0) * cell, y: rng.range(-1, 0) * cell };
  const step = 22 * u;
  // Lines are only emitted within a margin around the canvas; the rest can never be seen.
  const bounds: Rect = { x: -0.4 * w, y: -0.4 * h, w: 1.8 * w, h: 1.8 * h };

  const lensCount = rng.chance(0.3) ? 2 : 1;
  const focus = clearOfQuiet(ctx, ctx.focus, size * 0.2);
  const lenses: Lens[] = Array.from({ length: lensCount }, (_, i) => ({
    center: i === 0 ? focus : { x: rng.range(0.15, 0.85) * w, y: rng.range(0.15, 0.85) * h },
    sigma: size * rng.range(0.2, 0.34),
    strength:
      (rng.chance(0.72) ? 1 : -1) * rng.range(0.38, i === 0 ? 0.95 : 0.6) * (i === 0 ? 1 : 0.7),
  }));
  // A pinch cannot exceed -1 or the lattice folds over itself.
  for (const lens of lenses) lens.strength = Math.max(lens.strength, -0.5);
  const warp = makeWarp(lenses);

  // Build every cell of the unwarped lattice that could land on the canvas.
  const cells: Cell[][] = [];
  const reach = 1.6;
  const lines: Point[][] = [];
  if (kind === "square") {
    const cols = Math.ceil((w * reach) / cell) + 2;
    const rows = Math.ceil((h * reach) / cell) + 2;
    const x0 = origin.x - (cols * cell - w) / 2;
    const y0 = origin.y - (rows * cell - h) / 2;
    for (let j = 0; j < rows; j += 1) {
      const row: Cell[] = [];
      for (let i = 0; i < cols; i += 1) {
        const x = x0 + i * cell;
        const y = y0 + j * cell;
        const corners = [
          { x, y },
          { x: x + cell, y },
          { x: x + cell, y: y + cell },
          { x, y: y + cell },
        ];
        row.push({ corners, center: { x: x + cell / 2, y: y + cell / 2 } });
      }
      cells.push(row);
    }
    for (let i = 0; i <= cols; i += 1) {
      lines.push(
        sampleSegment(
          { x: x0 + i * cell, y: y0 },
          { x: x0 + i * cell, y: y0 + rows * cell },
          warp,
          step,
        ),
      );
    }
    for (let j = 0; j <= rows; j += 1) {
      lines.push(
        sampleSegment(
          { x: x0, y: y0 + j * cell },
          { x: x0 + cols * cell, y: y0 + j * cell },
          warp,
          step,
        ),
      );
    }
  } else {
    const rows = Math.ceil((h * reach) / rowHeight) + 2;
    const cols = Math.ceil((w * reach) / cell) + rows;
    const y0 = origin.y - (rows * rowHeight - h) / 2;
    const x0 = origin.x - (cols * cell - w) / 2 - (rows * cell) / 4;
    const point = (i: number, j: number): Point => ({
      x: x0 + (i + j / 2) * cell,
      y: y0 + j * rowHeight,
    });
    for (let j = 0; j < rows; j += 1) {
      const row: Cell[] = [];
      for (let i = 0; i < cols; i += 1) {
        const up = [point(i, j), point(i + 1, j), point(i, j + 1)];
        const down = [point(i, j + 1), point(i + 1, j + 1), point(i + 1, j)];
        for (const corners of [up, down]) {
          const center = {
            x: corners.reduce((s, p) => s + p.x, 0) / 3,
            y: corners.reduce((s, p) => s + p.y, 0) / 3,
          };
          row.push({ corners, center });
        }
      }
      cells.push(row);
    }
    for (let j = 0; j <= rows; j += 1) {
      lines.push(sampleSegment(point(0, j), point(cols, j), warp, step));
    }
    for (let i = -rows; i <= cols; i += 1) {
      lines.push(sampleSegment(point(i, 0), point(i + 0 * rows, rows), warp, step));
      lines.push(sampleSegment(point(i, rows), point(i + rows, 0), warp, step));
    }
  }

  // Lit cells: nearest to the lens center, in accent, then a scatter of shade and field around it.
  const flat = cells.flat();
  const centerOf = (c: Cell): Point => warp(c.center);
  const onCanvas = flat.filter((c) => {
    const p = centerOf(c);
    return p.x > -cell && p.x < w + cell && p.y > -cell && p.y < h + cell;
  });
  const ranked = [...onCanvas].sort(
    (a, b) =>
      Math.hypot(centerOf(a).x - focus.x, centerOf(a).y - focus.y) -
      Math.hypot(centerOf(b).x - focus.x, centerOf(b).y - focus.y),
  );
  const lit: { cell: Cell; fill: string }[] = [];
  const taken = new Set<Cell>();
  const nearType = (c: Cell): boolean => {
    const p = centerOf(c);
    return ctx.quiet.some(
      (r: Rect) =>
        p.x > r.x - cell && p.x < r.x + r.w + cell && p.y > r.y - cell && p.y < r.y + r.h + cell,
    );
  };
  const take = (c: Cell, fill: string): void => {
    taken.add(c);
    lit.push({ cell: c, fill });
  };
  const start = ranked.find((c) => !nearType(c));
  if (start) {
    // A connected run of cells grown across shared edges: accent first, then shade, then field.
    // Either a free random walk or a directed one that leans along a diagonal like a staircase.
    const directed = rng.chance(0.4);
    const heading = deg(rng.pick([-135, -45, 45, 135, 0, 90]));
    const dirX = Math.cos(heading);
    const dirY = Math.sin(heading);
    const reachDistance = kind === "square" ? cell * 1.02 : cell * 0.6;
    // Where the lens pinches the lattice, cells are small, so light more of them to keep the gesture readable.
    const warped = warpedPolygon(start.corners, warp, step);
    let area = 0;
    warped.forEach((p, i) => {
      const q = warped[(i + 1) % warped.length] as Point;
      area += p.x * q.y - q.x * p.y;
    });
    const nominal = kind === "square" ? cell * cell : (cell * cell * Math.sqrt(3)) / 4;
    const boost = Math.min(2.4, Math.max(1, 1 / Math.sqrt(Math.abs(area) / 2 / nominal || 1)));
    const base = rng.int(kind === "square" ? 6 : 10, kind === "square" ? 11 : 18);
    const total = Math.round(base * boost);
    const accentCount = rng.int(1, 2);
    const shadeEnd = accentCount + rng.int(2, 4);
    let current: Cell = start;
    const path: Cell[] = [];
    for (let attempt = 0; attempt < total * 8 && lit.length < total; attempt += 1) {
      if (!taken.has(current)) {
        const k = lit.length;
        take(current, k < accentCount ? pal.accent : k < shadeEnd ? pal.shade : pal.field);
        path.push(current);
      }
      const options = onCanvas.filter(
        (c) =>
          !taken.has(c) &&
          !nearType(c) &&
          Math.hypot(c.center.x - current.center.x, c.center.y - current.center.y) <= reachDistance,
      );
      let next: Cell | undefined;
      if (options.length) {
        next = directed
          ? options.reduce((best, c) => {
              const score = (v: Cell): number =>
                (v.center.x - current.center.x) * dirX +
                (v.center.y - current.center.y) * dirY +
                rng.next() * cell * 0.4;
              return score(c) > score(best) ? c : best;
            })
          : rng.pick(options);
      }
      if (next) current = next;
      else if (path.length > 0) current = rng.pick(path);
    }
  }

  const litMarkup = lit
    .map(
      ({ cell: c, fill }) =>
        `<path d="${smoothPath(warpedPolygon(c.corners, warp, step), true)}" fill="${fill}"/>`,
    )
    .join("");
  const lineColor = mixHex(pal.ground, pal.shade, pal.tone === "dark" ? 0.75 : 0.62);
  const linesMarkup = `<path d="${lines
    .flatMap((l) => inBoundsRuns(l, bounds))
    .map((l) => linePath(l))
    .join("")}" stroke="${lineColor}" stroke-width="${n(1.7 * u, 2)}"/>`;

  const clipId = `${ctx.uid}k`;
  return {
    defs: softKnockout(clipId, ctx.area, ctx.quiet, 26 * ctx.u),
    body: `<g mask="url(#${clipId})"><g fill="none" stroke-linejoin="round">${litMarkup.replace(/<path /g, '<path stroke="none" ')}${linesMarkup}</g></g>`,
  };
};
