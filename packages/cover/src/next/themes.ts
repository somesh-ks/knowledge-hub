import { mixHex, oklchToHex } from "../color.js";
import { type Rng, valueNoise } from "../prng.js";
import { n } from "../svg.js";
import type { DrawEnv, Drawn, Theme } from "./types.js";

/**
 * Monthly themes. A theme is a palette family, one generative motif and one surface treatment;
 * `draw` varies the motif from the episode seed in `env.rng`. To add a month, add one entry to
 * THEMES: months cycle through the list by year and month, so a past episode keeps its theme.
 */

const ok = (l: number, c: number, h: number): string => oklchToHex({ l, c, h });
const at = <T>(items: readonly T[], i: number): T =>
  items[((i % items.length) + items.length) % items.length] as T;

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const circle = (cx: number, cy: number, r: number, fill: string, extra = ""): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra}/>`;

/** Layered strata: wavy bands under a low sun, tilted. Surface: fine horizontal hatching. */
function strata({ box, rng, colors, uid }: DrawEnv): Drawn {
  const { x, y, w, h } = box;
  const m = Math.min(w, h);
  const { dark, light, art } = colors;
  const tilt = rng.range(-13, 13);
  const layers = rng.int(5, 8);
  const top = y + h * rng.range(0.3, 0.5);
  const weights = Array.from({ length: layers }, () => rng.range(0.6, 1.7));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = y + h * 1.6 - top;
  const offset = rng.int(0, art.length - 1);
  const steps = 28;
  const x0 = x - w * 0.5;
  const x1 = x + w * 1.5;

  let body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${mixHex(dark, at(art, offset), 0.22)}"/>`;
  body += circle(
    x + w * rng.range(0.2, 0.8),
    y + h * rng.range(0.2, 0.45),
    m * rng.range(0.15, 0.26),
    mixHex(light, at(art, offset + 1), 0.3),
  );

  let group = "";
  let base = top;
  for (let i = 0; i < layers; i += 1) {
    const amp = h * rng.range(0.015, 0.06);
    const f1 = rng.range(0.7, 2.2);
    const f2 = rng.range(2.4, 4.5);
    const p1 = rng.range(0, 6.28);
    const p2 = rng.range(0, 6.28);
    let d = "";
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t;
      const py =
        base + amp * Math.sin(f1 * t * 6.283 + p1) + amp * 0.35 * Math.sin(f2 * t * 6.283 + p2);
      d += `${s === 0 ? "M" : "L"}${n(px)} ${n(py)}`;
    }
    d += `L${n(x1)} ${n(y + h * 2)}L${n(x0)} ${n(y + h * 2)}Z`;
    group += `<path d="${d}" fill="${mixHex(at(art, i + offset), dark, (i / layers) * 0.5)}"/>`;
    base += (span * at(weights, i)) / total;
  }
  const hatch = `${uid}h`;
  const line = Math.max(1.2, m * 0.0035);
  const defs = `<pattern id="${hatch}" width="${n(line * 5)}" height="${n(line * 5)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${n(tilt)})"><rect width="${n(line * 5)}" height="${n(line)}" fill="${dark}" opacity="0.16"/></pattern>`;
  body += `<g transform="rotate(${n(tilt)} ${n(x + w / 2)} ${n(y + h / 2)})">${group}</g>`;
  body += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#${hatch})"/>`;
  return { defs, body };
}

/** Overlapping orbits: ring systems around two or three centres, planets, one lit disc. Surface: a soft glow. */
function orbits({ box, rng, colors, uid }: DrawEnv): Drawn {
  const { x, y, w, h } = box;
  const m = Math.min(w, h);
  const { dark, light, art } = colors;
  let body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${mixHex(dark, at(art, 3), 0.12)}"/>`;
  let defs = "";
  const centres = rng.int(2, 3);
  const discAt = rng.int(0, centres - 1);
  for (let c = 0; c < centres; c += 1) {
    const cx = x + w * rng.range(0.15, 0.85);
    const cy = y + h * rng.range(0.15, 0.85);
    const rings = rng.int(2, 4);
    const r0 = m * rng.range(0.1, 0.18);
    const step = m * rng.range(0.085, 0.15);
    const spin = rng.range(0, 360);
    if (c === discAt) {
      const gid = `${uid}g`;
      const r = m * rng.range(0.16, 0.26);
      defs += `<radialGradient id="${gid}" cx="0.36" cy="0.32" r="0.85"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${at(art, c)}"/><stop offset="1" stop-color="${mixHex(at(art, c), dark, 0.45)}"/></radialGradient>`;
      body += circle(cx, cy, r, `url(#${gid})`);
    }
    for (let i = 0; i < rings; i += 1) {
      const r = r0 + step * (i + 1);
      const sw = m * rng.range(0.012, 0.05);
      const color = at(art, c + i + 1);
      if (rng.chance(0.55)) {
        const a0 = ((spin + rng.range(0, 360)) * Math.PI) / 180;
        const sweep = (rng.range(80, 290) * Math.PI) / 180;
        const large = sweep > Math.PI ? 1 : 0;
        body += `<path d="M${n(cx + r * Math.cos(a0))} ${n(cy + r * Math.sin(a0))}A${n(r)} ${n(r)} 0 ${large} 1 ${n(cx + r * Math.cos(a0 + sweep))} ${n(cy + r * Math.sin(a0 + sweep))}" fill="none" stroke="${color}" stroke-width="${n(sw)}" stroke-linecap="round"/>`;
      } else {
        body += circle(
          cx,
          cy,
          r,
          "none",
          ` stroke="${color}" stroke-width="${n(sw)}" opacity="0.9"`,
        );
      }
      if (rng.chance(0.4)) {
        const a = rng.range(0, 6.283);
        body += circle(
          cx + r * Math.cos(a),
          cy + r * Math.sin(a),
          m * rng.range(0.025, 0.06),
          at(art, c + i + 2),
        );
      }
    }
  }
  const glow = `${uid}w`;
  defs += `<radialGradient id="${glow}" cx="${n(rng.range(0.25, 0.75), 2)}" cy="${n(rng.range(0.2, 0.6), 2)}" r="0.8"><stop offset="0" stop-color="${light}" stop-opacity="0.22"/><stop offset="1" stop-color="${dark}" stop-opacity="0.3"/></radialGradient>`;
  body += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#${glow})"/>`;
  return { defs, body };
}

/** Folded paper: a jittered triangulated field tinted by a smooth noise ramp. Surface: lit creases. */
function facets({ box, rng, colors }: DrawEnv): Drawn {
  const { x, y, w, h } = box;
  const { dark, light, art } = colors;
  const cell = Math.min(w, h) / rng.range(2.6, 4.4);
  const radius = Math.hypot(w, h) / 2 + cell * 2;
  const cols = Math.ceil((radius * 2) / cell) + 1;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const tilt = rng.range(-25, 25);
  const seed = rng.int(1, 1_000_000);
  const ramp = [
    mixHex(dark, at(art, 2), 0.25),
    at(art, 2),
    at(art, 0),
    at(art, 1),
    mixHex(light, at(art, 1), 0.4),
  ];
  const colorAt = (px: number, py: number): string => {
    const f = Math.min(0.9999, Math.max(0, valueNoise(px / (cell * 4.5), py / (cell * 4.5), seed)));
    const pos = f * (ramp.length - 1);
    const i = Math.floor(pos);
    return mixHex(at(ramp, i), at(ramp, i + 1), pos - i);
  };
  const pts: { x: number; y: number }[][] = [];
  for (let j = 0; j < cols; j += 1) {
    const row: { x: number; y: number }[] = [];
    for (let i = 0; i < cols; i += 1) {
      row.push({
        x: cx - radius + i * cell + rng.range(-0.38, 0.38) * cell,
        y: cy - radius + j * cell + rng.range(-0.38, 0.38) * cell,
      });
    }
    pts.push(row);
  }
  const tri = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ): string => {
    const mx = (a.x + b.x + c.x) / 3;
    const my = (a.y + b.y + c.y) / 3;
    const lit = mixHex(colorAt(mx, my), rng.chance(0.5) ? light : dark, rng.range(0.08, 0.34));
    return `<path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}L${n(c.x)} ${n(c.y)}Z" fill="${lit}" stroke="${lit}" stroke-width="1"/>`;
  };
  let group = "";
  for (let j = 0; j < cols - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const p00 = pts[j]?.[i];
      const p10 = pts[j]?.[i + 1];
      const p01 = pts[j + 1]?.[i];
      const p11 = pts[j + 1]?.[i + 1];
      if (!p00 || !p10 || !p01 || !p11) continue;
      if (rng.chance(0.5)) group += tri(p00, p10, p11) + tri(p00, p11, p01);
      else group += tri(p00, p10, p01) + tri(p10, p11, p01);
    }
  }
  // A few creases, drawn as light hairlines over the folds.
  let creases = "";
  for (let k = 0; k < 5; k += 1) {
    const a = pts[rng.int(0, cols - 1)]?.[rng.int(0, cols - 1)];
    const b = pts[rng.int(0, cols - 1)]?.[rng.int(0, cols - 1)];
    if (a && b)
      creases += `<path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" stroke="${light}" stroke-opacity="0.18" stroke-width="${n(cell * 0.025, 2)}"/>`;
  }
  return { body: `<g transform="rotate(${n(tilt)} ${n(cx)} ${n(cy)})">${group}${creases}</g>` };
}

export const THEMES: readonly Theme[] = [
  {
    id: "strata",
    name: "Strata",
    dark: ok(0.27, 0.05, 205),
    light: ok(0.93, 0.03, 165),
    art: [
      ok(0.8, 0.14, 78),
      ok(0.62, 0.16, 42),
      ok(0.52, 0.09, 200),
      ok(0.74, 0.08, 160),
      ok(0.45, 0.12, 15),
    ],
    draw: strata,
  },
  {
    id: "orbits",
    name: "Orbits",
    dark: ok(0.25, 0.09, 275),
    light: ok(0.93, 0.035, 295),
    art: [
      ok(0.73, 0.17, 25),
      ok(0.85, 0.14, 92),
      ok(0.82, 0.1, 178),
      ok(0.66, 0.13, 248),
      ok(0.58, 0.18, 320),
    ],
    draw: orbits,
  },
  {
    id: "facets",
    name: "Facets",
    dark: ok(0.26, 0.08, 10),
    light: ok(0.94, 0.025, 20),
    art: [
      ok(0.7, 0.14, 15),
      ok(0.82, 0.12, 72),
      ok(0.55, 0.13, 320),
      ok(0.66, 0.09, 205),
      ok(0.45, 0.14, 5),
    ],
    draw: facets,
  },
];

/** Theme of a calendar month. Cycles through THEMES, so Oct, Nov, Dec 2026 differ and every October of a given year agrees. */
export function themeFor(year: number, month: number): Theme {
  return at(THEMES, year * 12 + (month - 1));
}
