import { Resvg } from "@resvg/resvg-js";
import { hexToOklch, rgbToHex } from "./color.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { renderCoverSvg } from "./render.js";
import type { CoverMeta, CoverSpec } from "./types.js";

/** One colour of a drawn cover and the share of its area it covers, 0 to 1. */
export interface Swatch {
  hex: string;
  share: number;
}

/** The cover is read at this width: enough for every shape to own its pixels, cheap to scan. */
const SAMPLE_PX = 64;
/** Colours closer than this in OKLab are one colour: the blends along an antialiased edge. */
const SAME_COLOR = 0.06;
/** Under this share a colour is a speck. */
const MIN_SHARE = 0.003;
/** How far off the line between two colours a blend of them may sit. */
const BLEND_OFF_LINE = 0.02;

const lab = (hex: string): [number, number, number] => {
  const { l, c, h } = hexToOklch(hex);
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
};

/**
 * The colours a cover shows, largest area first, read from the drawn image itself. Whatever the
 * template, the season or the theme did to the palette, this is what the eye sees. The type is drawn
 * too: on some covers a numeral is the art.
 */
export function coverSwatches(spec: CoverSpec, meta: CoverMeta, count = 8): Swatch[] {
  const svg = renderCoverSvg(spec, meta, { wordmark: false });
  const { pixels } = new Resvg(svg, {
    fitTo: { mode: "width", value: SAMPLE_PX },
    font: RESVG_FONT_OPTIONS,
  }).render();
  const counts = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 250) continue;
    const hex = rgbToHex([pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
    total += 1;
  }
  // The flat fills hold most pixels; each edge blend joins the larger colour it sits closest to.
  const kept: { hex: string; at: [number, number, number]; n: number }[] = [];
  for (const [hex, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const at = lab(hex);
    const near = kept.find(
      (k) => Math.hypot(k.at[0] - at[0], k.at[1] - at[1], k.at[2] - at[2]) < SAME_COLOR,
    );
    if (near) near.n += n;
    else kept.push({ hex, at, n });
  }
  // An antialiased edge between two fills far apart is a colour of its own, on neither side of the
  // edge: one that sits on the line between two larger colours joins the nearer of them.
  const between = (p: number[], a: number[], b: number[]) => {
    const ab = a.map((v, i) => (b[i] ?? 0) - v);
    const ap = a.map((v, i) => (p[i] ?? 0) - v);
    const len = ab.reduce((sum, v) => sum + v * v, 0);
    const t = len > 0 ? ap.reduce((sum, v, i) => sum + v * (ab[i] ?? 0), 0) / len : -1;
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(...ap.map((v, i) => v - t * (ab[i] ?? 0))) < BLEND_OFF_LINE;
  };
  for (let i = kept.length - 1; i >= 2; i -= 1) {
    const k = kept[i];
    if (!k) continue;
    const larger = kept.slice(0, i);
    const pair = larger.flatMap((a, x) => larger.slice(x + 1).map((b) => [a, b] as const));
    const ends = pair.find(([a, b]) => between(k.at, a.at, b.at));
    if (!ends) continue;
    const [a, b] = ends;
    const near =
      Math.hypot(...a.at.map((v, j) => v - (k.at[j] ?? 0))) <=
      Math.hypot(...b.at.map((v, j) => v - (k.at[j] ?? 0)))
        ? a
        : b;
    near.n += k.n;
    kept.splice(i, 1);
  }
  const swatches = kept
    .map(({ hex, n }) => ({ hex, share: n / Math.max(total, 1) }))
    .sort((a, b) => b.share - a.share);
  const major = swatches.filter((s) => s.share >= MIN_SHARE);
  return (major.length > 0 ? major : swatches).slice(0, count);
}
