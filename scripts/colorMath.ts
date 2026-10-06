/**
 * OKLCH to sRGB conversion and WCAG 2.x contrast, with no dependencies.
 *
 * Why this exists: the token pipeline must prove contrast in CI without a color library, and
 * the build also derives the sRGB hex values that `theme-color` meta tags and the web manifest
 * need (those cannot take OKLCH reliably across browsers).
 */

export interface Oklch {
  /** Lightness, 0 to 1. */
  l: number;
  /** Chroma, roughly 0 to 0.37. */
  c: number;
  /** Hue in degrees. */
  h: number;
  /** Opacity, 0 to 1. */
  alpha: number;
}

export interface Rgb {
  /** Gamma-encoded sRGB, each channel 0 to 1 after clipping. */
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** False when the OKLCH color had to be clipped to fit sRGB. */
  inGamut: boolean;
}

const OKLCH_PATTERN =
  /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i;

/** Parses `oklch(49% 0.17 14)` and `oklch(0.49 0.17 14 / 0.4)`. Throws on anything else. */
export function parseOklch(css: string): Oklch {
  const match = OKLCH_PATTERN.exec(css.trim());
  if (!match) throw new Error(`Not an oklch() color: ${css}`);
  const [, lRaw, lPercent, cRaw, hRaw, alphaRaw, alphaPercent] = match;
  const l = Number(lRaw) / (lPercent === "%" ? 100 : 1);
  const alpha = alphaRaw === undefined ? 1 : Number(alphaRaw) / (alphaPercent === "%" ? 100 : 1);
  return { l, c: Number(cRaw), h: Number(hRaw), alpha };
}

function encodeGamma(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Linear-light sRGB before clipping, so callers can detect out-of-gamut colors. */
function oklchToLinearSrgb(color: Oklch): [number, number, number] {
  const hue = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hue);
  const b = color.c * Math.sin(hue);
  const lPrime = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = color.l - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToRgb(color: Oklch): Rgb {
  const [rLinear, gLinear, bLinear] = oklchToLinearSrgb(color);
  const epsilon = 0.0005;
  const inGamut = [rLinear, gLinear, bLinear].every((v) => v >= -epsilon && v <= 1 + epsilon);
  return {
    r: encodeGamma(rLinear),
    g: encodeGamma(gLinear),
    b: encodeGamma(bLinear),
    alpha: color.alpha,
    inGamut,
  };
}

function decodeGamma(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque sRGB color. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * decodeGamma(rgb.r) + 0.7152 * decodeGamma(rgb.g) + 0.0722 * decodeGamma(rgb.b);
}

/** Source-over composite of a translucent foreground on an opaque background, in gamma space. */
export function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.alpha;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    alpha: 1,
    inGamut: foreground.inGamut && background.inGamut,
  };
}

/** WCAG contrast ratio. A translucent foreground is composited over the background first. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const solidForeground = foreground.alpha < 1 ? composite(foreground, background) : foreground;
  const a = relativeLuminance(solidForeground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function toHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

export function oklchStringToRgb(css: string): Rgb {
  return oklchToRgb(parseOklch(css));
}
