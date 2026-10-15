import type { Rng } from "./prng.js";
import { n } from "./svg.js";
import { circle, rect } from "./templates/kit.js";
import type { Palette, TemplateId } from "./types.js";

/**
 * The art of a plate: eight small compositions drawn for the round disc, not full-bleed art shrunk
 * into it. Each is one gesture in flat fills, taken from a sleeve idiom (a horizon, a doorway, a
 * stripe rhythm, a stack of rainbows). Coordinates are local to the disc, in px, with the centre at
 * the origin, so a form reads at any size and the renderer clips it to the disc. The cover's template
 * picks the form, and the picker never repeats a template next to itself, so neighbours differ.
 */

type Form = (rng: Rng, r: number, pal: Palette) => string;

const path = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;

/** A half disc standing on a flat edge at y, its curve facing up. */
const dome = (x: number, y: number, radius: number, fill: string): string =>
  path(
    `M${n(x - radius)} ${n(y)}A${n(radius)} ${n(radius)} 0 0 1 ${n(x + radius)} ${n(y)}Z`,
    fill,
  );

/** A doorway: a stem and a half-round top, standing on y = base. */
const arch = (x: number, top: number, base: number, width: number, fill: string): string => {
  const h = width / 2;
  return path(
    `M${n(x - h)} ${n(base)}V${n(top + h)}A${n(h)} ${n(h)} 0 0 1 ${n(x + h)} ${n(top + h)}V${n(base)}Z`,
    fill,
  );
};

/** A sun on a horizon: its lower half is under the sea. */
const horizon: Form = (rng, r, pal) => {
  const y = r * rng.range(0.02, 0.3);
  const sun = r * rng.range(0.3, 0.42);
  const x = r * rng.range(-0.38, 0.38);
  const [sky, sea] = rng.chance(0.5) ? [pal.accent, pal.shade] : [pal.shade, pal.accent];
  return circle(x, y, sun, sky) + rect(-r, y, r * 2, r * 1.2, sea);
};

/** Two rolling hills under a small sun. */
const hills: Form = (rng, r, pal) => {
  const back = circle(r * rng.range(-0.7, -0.25), r * rng.range(0.8, 1.05), r * rng.range(0.72, 0.9), pal.shade);
  const front = circle(r * rng.range(0.25, 0.6), r * rng.range(1.0, 1.3), r * rng.range(0.85, 1.05), pal.accent);
  const sun = circle(r * rng.range(-0.3, 0.3), r * rng.range(-0.5, -0.3), r * rng.range(0.12, 0.18), pal.accent);
  return sun + back + front;
};

/** Stacked half discs: a rainbow cut flat at the base. */
const rainbow: Form = (rng, r, pal) => {
  const y = r * rng.range(0.28, 0.5);
  const steps = rng.int(3, 4);
  const outer = r * rng.range(0.78, 0.92);
  const colours = [pal.accent, pal.shade, pal.accent, pal.ground];
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    out.push(dome(0, y, outer * (1 - i / steps), colours[i] as string));
  }
  return out.join("");
};

/** Vertical stripes of unequal width, one of them the loud one. */
const stripes: Form = (rng, r, pal) => {
  const count = rng.int(5, 7);
  const weights = Array.from({ length: count }, () => rng.range(0.3, 1) ** 2);
  const total = weights.reduce((sum, v) => sum + v, 0);
  const hero = rng.int(1, count - 2);
  let x = -r;
  const out: string[] = [];
  weights.forEach((weight, i) => {
    const width = (r * 2 * weight) / total;
    const fill = i === hero ? pal.accent : i % 2 === 0 ? pal.shade : pal.ground;
    if (fill !== pal.ground) out.push(rect(x, -r, width, r * 2, fill));
    x += width;
  });
  return out.join("");
};

/** Doorways set inside doorways. */
const doorway: Form = (rng, r, pal) => {
  const x = r * rng.range(-0.2, 0.2);
  const width = r * rng.range(0.8, 1);
  const top = r * rng.range(-0.55, -0.3);
  const base = r * 1.1;
  const inner = width * rng.range(0.55, 0.66);
  return (
    arch(x, top, base, width, pal.accent) +
    arch(x, top + (width - inner) * 0.55, base, inner, pal.shade) +
    arch(x, top + (width - inner * 0.45) * 0.55, base, inner * 0.45, pal.ground)
  );
};

/** Three or four rounded bars on a slant, ragged like a sound level. */
const capsules: Form = (rng, r, pal) => {
  const count = rng.int(3, 4);
  const thick = r * rng.range(0.2, 0.26);
  const gap = thick * 0.5;
  const span = count * thick + (count - 1) * gap;
  const angle = rng.pick([-38, -30, 30, 38]);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const length = r * rng.range(0.9, 1.6);
    const x = r * rng.range(-0.3, 0.3) - length / 2;
    const y = -span / 2 + i * (thick + gap);
    const fill = i % 2 === 0 ? pal.accent : pal.shade;
    out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(length)}" height="${n(thick)}" rx="${n(thick / 2)}" fill="${fill}"/>`,
    );
  }
  return `<g transform="rotate(${angle})">${out.join("")}</g>`;
};

/** Two overlapping discs, the overlap in the loud colour. */
const lens: Form = (rng, r, pal) => {
  const d = r * rng.range(0.2, 0.3);
  const radius = r * rng.range(0.56, 0.66);
  const h = Math.sqrt(radius * radius - d * d);
  const angle = rng.pick([0, 90, 45, -45]);
  const overlap = path(
    `M0 ${n(-h)}A${n(radius)} ${n(radius)} 0 0 1 0 ${n(h)}A${n(radius)} ${n(radius)} 0 0 1 0 ${n(-h)}Z`,
    pal.accent,
  );
  return `<g transform="rotate(${angle})">${circle(-d, 0, radius, pal.shade)}${circle(d, 0, radius, pal.shade)}${overlap}</g>`;
};

/** Four quarter discs on a square: lobes at its corners, or a pinwheel. */
const tiles: Form = (rng, r, pal) => {
  const h = r * rng.range(0.6, 0.68);
  const pinwheel = rng.chance(0.5);
  // Centre of each quarter disc, and the direction it opens in. Tiles run clockwise from top left.
  const lobes = [
    [-h, -h, 1, 1],
    [h, -h, -1, 1],
    [h, h, -1, -1],
    [-h, h, 1, -1],
  ] as const;
  const wheel = [
    [0, -h, -1, 1],
    [h, 0, -1, -1],
    [0, h, 1, -1],
    [-h, 0, 1, 1],
  ] as const;
  return (pinwheel ? wheel : lobes)
    .map(([cx, cy, dx, dy], i) =>
      path(
        `M${n(cx)} ${n(cy)}L${n(cx + dx * h)} ${n(cy)}A${n(h)} ${n(h)} 0 0 ${dx * dy > 0 ? 1 : 0} ${n(cx)} ${n(cy + dy * h)}Z`,
        i % 2 === 0 ? pal.accent : pal.shade,
      ),
    )
    .join("");
};

const FORMS: Record<TemplateId, Form> = {
  spring: horizon,
  contour: hills,
  orbit: rainbow,
  dither: stripes,
  numeral: doorway,
  band: capsules,
  aperture: lens,
  lattice: tiles,
};

/** The art for a plate of radius `r` centred on the canvas point (cx, cy). */
export function plateArt(
  template: TemplateId,
  rng: Rng,
  plate: { cx: number; cy: number; r: number },
  pal: Palette,
): string {
  const flip = rng.sign();
  const body = FORMS[template](rng, plate.r, pal);
  return `<g transform="translate(${n(plate.cx)} ${n(plate.cy)}) scale(${flip} 1)">${body}</g>`;
}
