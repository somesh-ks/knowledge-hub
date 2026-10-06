import { mixHex } from "../color.js";
import { lerp, TAU } from "../math.js";
import { knockoutClip, smoothPath } from "../svg.js";
import type { Point, Template } from "../types.js";

/**
 * Band: stacked wave bands. Every boundary is the same wave with a phase shift, so the stack swells,
 * pinches and fans like a waveform. The ribbon sits in the middle of the cover and leaves flat
 * ground above and below for the type.
 */

type Envelope = "lens" | "ramp" | "steady";
type Scheme = "tonal" | "ribbons" | "duotone";
type Spacing = "even" | "ramp" | "random";

export const band: Template = (ctx) => {
  const { rng, w, u, pal } = ctx;
  const bottomLockup = ctx.corner === "bl" || ctx.corner === "br";
  const lock = ctx.quiet[0] ?? { x: 0, y: 0, w: 0, h: 0 };
  const mark = ctx.quiet[1] ?? lock;
  const free = bottomLockup
    ? { top: mark.y + mark.h + 10 * u, bottom: lock.y - 14 * u }
    : { top: lock.y + lock.h + 14 * u, bottom: mark.y - 10 * u };
  const span = Math.max(free.bottom - free.top, 120 * u);
  const envelope = rng.weighted<Envelope>(["lens", "ramp", "steady"], (e) =>
    e === "lens" ? 4 : e === "ramp" ? 3 : 2,
  );
  const scheme = rng.weighted<Scheme>(["tonal", "ribbons", "duotone"], (s) =>
    s === "tonal" ? 3 : s === "ribbons" ? 4 : 2,
  );
  const spacingMode = rng.weighted<Spacing>(["even", "ramp", "random"], (s) =>
    s === "even" ? 2 : s === "ramp" ? 4 : 3,
  );
  const count = scheme === "ribbons" ? rng.int(10, 20) : rng.int(7, 14);

  // Band stack height and where it floats inside the free space.
  const stack = span * rng.range(0.3, 0.52);
  const center = free.top + span / 2;
  const top = center - stack / 2;
  const cycles = rng.range(0.7, 2.1);
  const harmonic = rng.range(0.15, 0.4);
  const harmonicRatio = rng.pick([2, 3]);
  const phaseStep = rng.range(0.1, 0.42);
  const phase0 = rng.range(0, TAU);
  // Waves may swing the stack as far as the free space allows, never past it.
  const amplitude = Math.min(
    span * rng.range(0.2, 0.34),
    (span - stack) / 2 / (1 + harmonic * 0.9),
  );

  const weights = Array.from({ length: count }, (_, k) => {
    if (spacingMode === "even") return 1;
    if (spacingMode === "ramp") return 0.4 + (k / (count - 1)) ** 1.5 * 1.8;
    return rng.range(0.4, 1.7);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const bases: number[] = [top];
  for (const weight of weights) {
    bases.push((bases[bases.length - 1] as number) + (weight / total) * stack);
  }

  const env = (x: number): number => {
    const t = Math.min(1, Math.max(0, x / w));
    if (envelope === "lens") return Math.sin(Math.PI * t) ** 0.8;
    if (envelope === "ramp") return 0.18 + 0.82 * t;
    return 1;
  };
  const samples = 90;
  const boundary = (k: number): Point[] =>
    Array.from({ length: samples + 1 }, (_, s) => {
      const x = lerp(-0.04 * w, 1.04 * w, s / samples);
      const t = x / w;
      const phase = phase0 + k * phaseStep;
      const wave =
        Math.sin(TAU * cycles * t + phase) +
        harmonic * Math.sin(TAU * cycles * harmonicRatio * t + phase * 1.7);
      return { x, y: (bases[k] as number) + amplitude * env(x) * wave };
    });
  const boundaries = bases.map((_, k) => boundary(k));

  const accentIndex = rng.int(Math.floor(count * 0.3), Math.floor(count * 0.72));
  const ink = mixHex(pal.shade, pal.text, pal.tone === "dark" ? 0.2 : 0.35);
  const duo = [pal.shade, pal.field];
  let fills: (string | null)[];
  if (scheme === "tonal") {
    fills = Array.from({ length: count }, (_, k) =>
      k === accentIndex
        ? pal.accent
        : mixHex(pal.field, pal.shade, 0.1 + 0.9 * (k / (count - 1)) ** 1.1),
    );
  } else if (scheme === "ribbons") {
    fills = Array.from({ length: count }, (_, k) =>
      k === accentIndex ? pal.accent : k % 2 === 0 ? ink : null,
    );
  } else {
    fills = Array.from({ length: count }, (_, k) =>
      k === accentIndex ? pal.accent : (duo[k % 2] as string),
    );
  }

  const bodies = fills
    .map((fill, k) => {
      if (!fill) return "";
      const upper = boundaries[k] as Point[];
      const lower = (boundaries[k + 1] as Point[]).slice().reverse();
      const outline = smoothPath([...upper, ...lower], true);
      return `<path d="${outline}" fill="${fill}"/>`;
    })
    .join("");

  const clipId = `${ctx.uid}k`;
  return {
    defs: knockoutClip(clipId, ctx.area, ctx.quiet),
    body: `<g clip-path="url(#${clipId})">${bodies}</g>`,
  };
};
