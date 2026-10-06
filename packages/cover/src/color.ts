/**
 * OKLCH to sRGB with gamut clamping, plus the contrast math the palettes are verified with.
 * resvg does not understand `oklch()`, so every color is converted to a hex string here.
 * Matrices are Bjorn Ottosson's reference OKLab implementation.
 */

export interface Oklch {
  /** Lightness, 0 to 1. */
  l: number;
  /** Chroma, 0 to roughly 0.4. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i;

/** Parses `oklch(70% 0.165 14)` or `oklch(0.7 0.165 14)`. */
export function parseOklch(input: string): Oklch {
  const match = OKLCH_PATTERN.exec(input.trim());
  if (!match) throw new Error(`Not an oklch() color: ${input}`);
  const [, lightness, percent, chroma, hue] = match;
  const l = Number(lightness) / (percent ? 100 : 1);
  const c = Number(chroma);
  const h = Number(hue);
  if (![l, c, h].every(Number.isFinite)) throw new Error(`Invalid oklch() components: ${input}`);
  return { l, c, h };
}

type Triple = [number, number, number];

function oklchToLinear({ l, c, h }: Oklch): Triple {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const GAMUT_EPSILON = 1e-5;

function inGamut(rgb: Triple): boolean {
  return rgb.every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);
}

/** Reduces chroma at constant lightness and hue until the color fits sRGB. */
export function clampToGamut(color: Oklch): Oklch {
  const l = Math.min(1, Math.max(0, color.l));
  if (l >= 1) return { l: 1, c: 0, h: color.h };
  if (l <= 0) return { l: 0, c: 0, h: color.h };
  if (inGamut(oklchToLinear({ ...color, l }))) return { ...color, l };
  let low = 0;
  let high = color.c;
  for (let i = 0; i < 28; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) low = mid;
    else high = mid;
  }
  return { l, c: low, h: color.h };
}

function encodeGamma(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function decodeGamma(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** Gamut-clamped sRGB as 8-bit channels. */
export function oklchToRgb(color: Oklch): [number, number, number] {
  const linear = oklchToLinear(clampToGamut(color));
  return linear.map((v) => Math.round(encodeGamma(v) * 255)) as Triple;
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** sRGB hex to OKLCH, the inverse of `oklchToHex` up to 8-bit rounding. */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map((v) => decodeGamma(v / 255)) as Triple;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/** WCAG 2 relative luminance of a hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => decodeGamma(v / 255)) as Triple;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toLab({ l, c, h }: Oklch): Triple {
  const hr = (h * Math.PI) / 180;
  return [l, c * Math.cos(hr), c * Math.sin(hr)];
}

function fromLab([l, a, b]: Triple): Oklch {
  const c = Math.hypot(a, b);
  return { l, c, h: c < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** Interpolates in OKLab, which keeps hue and lightness steps even. */
export function mixOklch(from: Oklch, to: Oklch, t: number): Oklch {
  const a = toLab(from);
  const b = toLab(to);
  return fromLab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Mixes two hex colors in OKLab and returns hex. */
export function mixHex(from: string, to: string, t: number): string {
  return oklchToHex(mixOklch(hexToOklch(from), hexToOklch(to), t));
}

/** Per-channel multiply in sRGB, the flat stand-in for a multiply blend overlap. */
export function multiplyHex(a: string, b: string): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([
    Math.round((ar * br) / 255),
    Math.round((ag * bg) / 255),
    Math.round((ab * bb) / 255),
  ]);
}

/** Per-channel screen in sRGB, used for overlaps on dark palettes. */
export function screenHex(a: string, b: string): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([
    255 - Math.round(((255 - ar) * (255 - br)) / 255),
    255 - Math.round(((255 - ag) * (255 - bg)) / 255),
    255 - Math.round(((255 - ab) * (255 - bb)) / 255),
  ]);
}
