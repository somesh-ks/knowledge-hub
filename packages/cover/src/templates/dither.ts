import { mixHex } from "../color.js";
import { clamp, deg, smoothstep } from "../math.js";
import { clearOfQuiet, lockupCenter, quietFade } from "../place.js";
import { fbm } from "../prng.js";
import { makeShape, type ShapeKind } from "../shapes.js";
import { n } from "../svg.js";
import type { Ctx, Point, Template } from "../types.js";

/**
 * Dither: ordered-dither gradients on a coarse pixel grid, set against hard vector geometry. Either
 * a sphere made of pixels with an accent satellite, or a full-bleed gradient with a flat shape cut
 * from it. The crisp edge against the coarse cell is the whole idea.
 */

/** Bayer threshold matrix of side 2^order, values in (0, 1). */
export function bayerMatrix(order: number): number[][] {
  let m: number[][] = [[0]];
  for (let step = 0; step < order; step += 1) {
    const size = m.length;
    const next: number[][] = Array.from({ length: size * 2 }, () =>
      new Array<number>(size * 2).fill(0),
    );
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = (m[y] as number[])[x] as number;
        (next[y] as number[])[x] = 4 * v;
        (next[y] as number[])[x + size] = 4 * v + 2;
        (next[y + size] as number[])[x] = 4 * v + 3;
        (next[y + size] as number[])[x + size] = 4 * v + 1;
      }
    }
    m = next;
  }
  const total = m.length * m.length;
  return m.map((row) => row.map((v) => (v + 0.5) / total));
}

type FieldKind = "linear" | "radial" | "bar";
type Layout = "sphere" | "cut";

interface Cells {
  ink: string;
  ghost: string;
}

/** Runs the ordered dither over the grid; `field` returns density in [0, 1], or below 0 to skip. */
function ditherCells(
  ctx: Ctx,
  cell: number,
  bayer: number[][],
  levels: 1 | 2,
  field: (x: number, y: number) => number,
): Cells {
  const side = bayer.length;
  const cols = Math.ceil(ctx.w / cell);
  const rows = Math.ceil(ctx.h / cell);
  const tones: string[][] = [[], []];
  for (let row = 0; row < rows; row += 1) {
    const y = row * cell;
    let open: { tone: number; start: number } | null = null;
    const flush = (end: number): void => {
      if (open && open.tone > 0) {
        const length = (end - open.start) * cell;
        (tones[open.tone - 1] as string[]).push(
          `M${n(open.start * cell)} ${n(y)}h${n(length)}v${n(cell)}h${n(-length)}Z`,
        );
      }
    };
    for (let col = 0; col < cols; col += 1) {
      const v = field(col * cell + cell / 2, y + cell / 2);
      let tone = 0;
      if (v > 0) {
        const threshold = (bayer[row % side] as number[])[col % side] as number;
        if (levels === 2) {
          const scaled = v * 2;
          tone = Math.min(
            2,
            Math.floor(scaled) + (scaled - Math.floor(scaled) > threshold ? 1 : 0),
          );
        } else {
          tone = v > threshold ? 2 : 0;
        }
      }
      if (open && open.tone === tone) continue;
      flush(col);
      open = { tone, start: col };
    }
    flush(cols);
  }
  return { ghost: (tones[0] as string[]).join(""), ink: (tones[1] as string[]).join("") };
}

export const dither: Template = (ctx) => {
  const { rng, w, h, u, pal } = ctx;
  const size = Math.min(w, h);
  const cell = Math.max(4, Math.round(rng.pick([10, 12, 14, 16, 18]) * u));
  const bayer = bayerMatrix(rng.pick([2, 3, 3]));
  const levels = rng.chance(0.4) ? 2 : 1;
  const layout = rng.weighted<Layout>(["sphere", "cut"], (l) => (l === "sphere" ? 6 : 4));
  const dark = pal.tone === "dark";
  const ink = mixHex(pal.shade, pal.text, dark ? 0.3 : 0.5);
  const ghost = mixHex(pal.ground, pal.shade, dark ? 0.38 : 0.3);
  const clearing = [150 * u, 250 * u];

  if (layout === "sphere") {
    const kind = rng.weighted<ShapeKind>(["disc", "arch", "half", "box"], (k) =>
      k === "disc" ? 7 : k === "box" ? 1 : 2,
    );
    const radius = size * rng.range(0.27, 0.37);
    const center = clearOfQuiet(
      ctx,
      { x: ctx.focus.x + rng.range(-0.04, 0.04) * w, y: ctx.focus.y + rng.range(-0.04, 0.04) * h },
      radius * 1.02,
    );
    const body = makeShape(rng, kind, center, radius);
    const angle = deg(rng.pick([-135, -110, -45, -70, 20, 160, 200]));
    const light = { x: Math.cos(angle), y: Math.sin(angle) };
    const gamma = rng.range(0.8, 1.5);
    const rim = rng.range(0, 0.22);
    const warpFreq = rng.range(2, 4);
    const field = (x: number, y: number): number => {
      if (body.sdf({ x, y }) > 0) return -1;
      const t = ((x - center.x) * -light.x + (y - center.y) * -light.y) / radius;
      const warp = (fbm((x / size) * warpFreq, (y / size) * warpFreq, ctx.seed, 2) - 0.5) * 0.18;
      return clamp((0.5 + 0.55 * t + warp) ** gamma + rim, 0, 1);
    };
    const cells = ditherCells(ctx, cell, bayer, levels, field);
    const clipId = `${ctx.uid}b`;
    const satelliteR = size * rng.range(0.05, 0.085);
    const orbitDist = radius + satelliteR * rng.range(0.1, 0.9);
    const satAngle = Math.atan2(light.y, light.x) + deg(rng.range(-50, 50));
    const cleared = clearOfQuiet(
      ctx,
      {
        x: center.x + Math.cos(satAngle) * orbitDist,
        y: center.y + Math.sin(satAngle) * orbitDist,
      },
      satelliteR,
    );
    // Keep the satellite whole inside the frame, even when dodging the type pushed it to an edge.
    const satellite = {
      x: clamp(cleared.x, satelliteR + 24 * u, w - satelliteR - 24 * u),
      y: clamp(cleared.y, satelliteR + 24 * u, h - satelliteR - 24 * u),
    };
    const accentBall = rng.chance(0.45);
    const ballFill = accentBall ? pal.accent : ink;
    const satFill = accentBall ? pal.text : pal.accent;
    const outline = `<g fill="none" stroke="${mixHex(pal.ground, pal.shade, 0.7)}" stroke-width="${n(1.6 * u, 2)}">${body.clip}</g>`;
    return {
      defs: `<clipPath id="${clipId}">${body.clip}</clipPath>`,
      body:
        `<g clip-path="url(#${clipId})" shape-rendering="crispEdges">` +
        (cells.ghost ? `<path d="${cells.ghost}" fill="${ghost}"/>` : "") +
        `<path d="${cells.ink}" fill="${ballFill}"/></g>` +
        outline +
        `<circle cx="${n(satellite.x)}" cy="${n(satellite.y)}" r="${n(satelliteR)}" fill="${satFill}"/>`,
    };
  }

  const kind = rng.weighted<ShapeKind>(
    ["disc", "ring", "arch", "half", "box", "diamond", "triangle"],
    (k) => (k === "disc" ? 5 : k === "ring" ? 3 : k === "arch" ? 3 : k === "half" ? 3 : 2),
  );
  const radius = size * rng.range(0.14, 0.24);
  const center = clearOfQuiet(
    ctx,
    { x: ctx.focus.x + rng.range(-0.06, 0.06) * w, y: ctx.focus.y + rng.range(-0.06, 0.06) * h },
    radius * 1.05,
  );
  const shape = makeShape(rng, kind, center, radius);
  const from = lockupCenter(ctx);
  const dirLen = Math.hypot(center.x - from.x, center.y - from.y) || 1;
  const dir = { x: (center.x - from.x) / dirLen, y: (center.y - from.y) / dirLen };
  const sweepLen = Math.abs(w * dir.x) + Math.abs(h * dir.y);
  const fieldKind = rng.weighted<FieldKind>(["linear", "radial", "bar"], (k) =>
    k === "linear" ? 4 : k === "radial" ? 3 : 2,
  );
  const gamma = rng.range(0.9, 1.7);
  const a0 = rng.range(0.1, 0.4);
  const a1 = rng.range(0.8, 1.15);
  const barAt = rng.range(0.5, 0.82);
  const barWidth = rng.range(0.14, 0.3);
  const radialR = size * rng.range(0.6, 1);
  const radialAt: Point = {
    x: center.x + dir.x * size * rng.range(0.05, 0.4),
    y: center.y + dir.y * size * rng.range(0.05, 0.4),
  };
  const haloReach = size * rng.range(0.14, 0.3);
  const haloAmount = rng.range(0.1, 0.4);
  const ceiling = levels === 2 ? 0.86 : 0.96;
  const base = (x: number, y: number): number => {
    const along = clamp(((x - from.x) * dir.x + (y - from.y) * dir.y) / sweepLen, 0, 1.2);
    if (fieldKind === "linear") return smoothstep(a0, a1, along);
    if (fieldKind === "bar") return Math.exp(-(((along - barAt) / barWidth) ** 2));
    return clamp(1 - Math.hypot(x - radialAt.x, y - radialAt.y) / radialR, 0, 1);
  };
  const field = (x: number, y: number): number => {
    const d = shape.sdf({ x, y });
    if (d <= 0) return -1;
    const halo = clamp(1 - d / haloReach, 0, 1) ** 2 * haloAmount;
    const v = Math.min(ceiling, base(x, y) ** gamma + halo) * quietFade(ctx, { x, y }, clearing);
    return clamp(v, 0, 1);
  };
  const cells = ditherCells(ctx, cell, bayer, levels, field);

  let inner = "";
  let defs = "";
  if (rng.chance(0.4)) {
    const clipId = `${ctx.uid}s`;
    defs = `<clipPath id="${clipId}">${shape.clip}</clipPath>`;
    const shadeFill = mixHex(pal.accent, dark ? pal.ground : pal.text, 0.4);
    const side = bayer.length;
    const path: string[] = [];
    const rowFrom = Math.floor((center.y - radius * 1.5) / cell);
    const rowTo = Math.ceil((center.y + radius * 1.5) / cell);
    const colFrom = Math.floor((center.x - radius * 1.3) / cell);
    const colTo = Math.ceil((center.x + radius * 1.3) / cell);
    for (let row = rowFrom; row < rowTo; row += 1) {
      for (let col = colFrom; col < colTo; col += 1) {
        const t =
          ((col * cell + cell / 2 - center.x) * dir.x +
            (row * cell + cell / 2 - center.y) * dir.y) /
          radius;
        const threshold = (bayer[((row % side) + side) % side] as number[])[
          ((col % side) + side) % side
        ] as number;
        if (clamp(0.5 + t * 0.55, 0, 1) ** 1.3 > threshold) {
          path.push(`M${n(col * cell)} ${n(row * cell)}h${n(cell)}v${n(cell)}h${n(-cell)}Z`);
        }
      }
    }
    inner = `<g clip-path="url(#${clipId})"><path d="${path.join("")}" fill="${shadeFill}" shape-rendering="crispEdges"/></g>`;
  }
  return {
    defs,
    body:
      `<g shape-rendering="crispEdges">${cells.ghost ? `<path d="${cells.ghost}" fill="${ghost}"/>` : ""}<path d="${cells.ink}" fill="${ink}"/></g>` +
      shape.draw(pal.accent) +
      inner,
  };
};
