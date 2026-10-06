import { mixHex, multiplyHex, screenHex } from "../color.js";
import { deg } from "../math.js";
import { insideRect } from "../place.js";
import { knockoutClip, n } from "../svg.js";
import type { Ctx, Point, Template } from "../types.js";

/**
 * Aperture: overlapping circles. Where two circles meet they form a lens, filled with a flat tint
 * computed from the two (multiply on light grounds, screen on dark), the way a blend would read.
 * The one focal overlap takes the accent.
 */

type Arrangement = "pair" | "chain" | "rosette" | "eclipse";

interface Disc {
  c: Point;
  r: number;
  fill: string;
}

interface Layout {
  arrangement: Arrangement;
  discs: Disc[];
  /** Index pairs whose lens is the accent focal. */
  focal: [number, number][];
}

function overlaps(a: Disc, b: Disc): boolean {
  const d = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y);
  return d < a.r + b.r - 1 && d > Math.abs(a.r - b.r) + 1;
}

function generate(ctx: Ctx, arrangement: Arrangement): Layout {
  const { rng, w, h, pal } = ctx;
  const size = Math.min(w, h);
  const focus = ctx.focus;
  const angle = deg(rng.range(0, 360));
  const bold = [pal.field, pal.shade];
  switch (arrangement) {
    case "pair": {
      const r1 = size * rng.range(0.26, 0.42);
      const r2 = size * rng.range(0.22, 0.4);
      const gap = (r1 + r2) * rng.range(0.52, 0.92);
      const a: Disc = {
        c: { x: focus.x - (Math.cos(angle) * gap) / 2, y: focus.y - (Math.sin(angle) * gap) / 2 },
        r: r1,
        fill: pal.field,
      };
      const b: Disc = {
        c: { x: focus.x + (Math.cos(angle) * gap) / 2, y: focus.y + (Math.sin(angle) * gap) / 2 },
        r: r2,
        fill: pal.shade,
      };
      return { arrangement, discs: [a, b], focal: [[0, 1]] };
    }
    case "chain": {
      const count = rng.int(4, 6);
      const r = size * rng.range(0.15, 0.24);
      const spacing = r * rng.range(0.95, 1.4);
      const discs: Disc[] = Array.from({ length: count }, (_, i) => {
        const offset = (i - (count - 1) / 2) * spacing;
        return {
          c: { x: focus.x + Math.cos(angle) * offset, y: focus.y + Math.sin(angle) * offset },
          r: r * (1 + (rng.chance(0.3) ? rng.range(-0.15, 0.2) : 0)),
          fill: bold[i % 2] as string,
        };
      });
      const focalIndex = rng.int(0, count - 2);
      return { arrangement, discs, focal: [[focalIndex, focalIndex + 1]] };
    }
    case "rosette": {
      const count = rng.int(3, 5);
      const r = size * rng.range(0.2, 0.3);
      const orbit = r * rng.range(0.55, 0.85);
      const discs: Disc[] = Array.from({ length: count }, (_, i) => ({
        c: {
          x: focus.x + Math.cos(angle + (i * Math.PI * 2) / count) * orbit,
          y: focus.y + Math.sin(angle + (i * Math.PI * 2) / count) * orbit,
        },
        r,
        fill: count % 2 === 1 && i === count - 1 ? pal.field : (bold[i % 2] as string),
      }));
      return { arrangement, discs, focal: [[0, 1]] };
    }
    default: {
      const big = size * rng.range(0.4, 0.58);
      const small = size * rng.range(0.13, 0.22);
      const outer: Disc = { c: focus, r: big, fill: pal.shade };
      const edge = big * rng.range(0.82, 1.08);
      const inner: Disc = {
        c: { x: focus.x + Math.cos(angle) * edge, y: focus.y + Math.sin(angle) * edge },
        r: small,
        fill: pal.field,
      };
      return { arrangement, discs: [outer, inner], focal: [[0, 1]] };
    }
  }
}

/** How much of the type zones a layout covers, sampled; lower is better. */
function typeCoverage(ctx: Ctx, discs: readonly Disc[]): number {
  let hits = 0;
  for (const rect of ctx.quiet) {
    for (let iy = 0; iy <= 4; iy += 1) {
      for (let ix = 0; ix <= 6; ix += 1) {
        const p = { x: rect.x + (rect.w * ix) / 6, y: rect.y + (rect.h * iy) / 4 };
        if (
          insideRect(p, rect) &&
          discs.some((d) => Math.hypot(p.x - d.c.x, p.y - d.c.y) < d.r + 4)
        )
          hits += 1;
      }
    }
  }
  return hits;
}

export const aperture: Template = (ctx) => {
  const { rng, w, h, u, pal } = ctx;
  const arrangement = rng.weighted<Arrangement>(["pair", "chain", "rosette", "eclipse"], (a) =>
    a === "pair" ? 5 : a === "chain" ? 4 : a === "rosette" ? 2 : 4,
  );

  let best: Layout | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 44; attempt += 1) {
    const layout = generate(ctx, arrangement);
    // Each try drifts and shrinks a little more, so a layout slides and tightens until it clears the type.
    const jitter = { x: rng.range(-0.18, 0.18) * w, y: rng.range(-0.18, 0.18) * h };
    const scale = 1 - attempt * 0.011;
    const cx = layout.discs.reduce((sum, d) => sum + d.c.x, 0) / layout.discs.length;
    const cy = layout.discs.reduce((sum, d) => sum + d.c.y, 0) / layout.discs.length;
    for (const d of layout.discs) {
      d.c = { x: cx + (d.c.x - cx) * scale + jitter.x, y: cy + (d.c.y - cy) * scale + jitter.y };
      d.r *= scale;
    }
    const visible = layout.discs.some(
      (d) =>
        d.c.x + d.r > w * 0.25 &&
        d.c.x - d.r < w * 0.75 &&
        d.c.y + d.r > h * 0.25 &&
        d.c.y - d.r < h * 0.75,
    );
    const score = typeCoverage(ctx, layout.discs) + (visible ? 0 : 1000);
    if (score < bestScore) {
      best = layout;
      bestScore = score;
    }
    if (score === 0) break;
  }
  const layout = best as Layout;
  const { discs } = layout;
  const blend = pal.tone === "dark" ? screenHex : multiplyHex;
  const outline = mixHex(pal.ground, pal.shade, 0.75);

  const defs = discs
    .map(
      (d, i) =>
        `<clipPath id="${ctx.uid}d${i}"><circle cx="${n(d.c.x)}" cy="${n(d.c.y)}" r="${n(d.r)}"/></clipPath>`,
    )
    .join("");
  const circles = discs
    .map((d) => `<circle cx="${n(d.c.x)}" cy="${n(d.c.y)}" r="${n(d.r)}" fill="${d.fill}"/>`)
    .join("");

  let lenses = "";
  for (let i = 0; i < discs.length; i += 1) {
    for (let j = i + 1; j < discs.length; j += 1) {
      const a = discs[i] as Disc;
      const b = discs[j] as Disc;
      if (!overlaps(a, b)) continue;
      const focal = layout.focal.some(([p, q]) => p === i && q === j);
      const fill = focal ? pal.accent : blend(a.fill, b.fill);
      lenses += `<g clip-path="url(#${ctx.uid}d${i})"><circle cx="${n(b.c.x)}" cy="${n(b.c.y)}" r="${n(b.r)}" fill="${fill}"/></g>`;
    }
  }
  const outlines = discs
    .map(
      (d) =>
        `<circle cx="${n(d.c.x)}" cy="${n(d.c.y)}" r="${n(d.r)}" fill="none" stroke="${outline}" stroke-width="${n(1.6 * u, 2)}"/>`,
    )
    .join("");

  const clipId = `${ctx.uid}k`;
  return {
    defs: defs + knockoutClip(clipId, ctx.area, ctx.quiet),
    body: `<g clip-path="url(#${clipId})">${circles}${lenses}${outlines}</g>`,
  };
};
