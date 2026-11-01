import tokens from "../../../tokens/covers.json" with { type: "json" };
import { hexToOklch, type Oklch, oklchToHex } from "./color.js";
import type { CoverMode } from "./mode.js";

/**
 * How a style (Settings, Style) redraws a cover (D314). The page does it in CSS: `cover.css` holds
 * the formula, `tokens.css` the numbers (`--cover-*`, written from `tokens/covers.json` by
 * `buildTokens`). This file holds the same formula in code so the contrast of every month under every
 * style is tested, and so `tokens.css` can be checked against the rule; it draws nothing.
 */

type Band = readonly [number, number];

export interface StyleRule {
  hue: number;
  keep: number;
  spread: number;
  cap: number;
  chroma: { scale: number; add: number; max: number; floorBelow: number; floor: number };
  /** Lightness is mirrored inside this band per theme; absent, it is kept. */
  flip?: Record<CoverMode, Band>;
  night?: { below: number; hue: number; chroma: number };
}

const value = (node: unknown, where: string): unknown => {
  if (typeof node !== "object" || node === null || !("$value" in node)) {
    throw new Error(`tokens/covers.json: style.${where} needs a $value`);
  }
  return node.$value;
};
const num = (node: unknown, where: string): number => {
  const v = value(node, where);
  if (typeof v !== "number") throw new Error(`tokens/covers.json: style.${where} must be a number`);
  return v;
};
const band = (node: unknown, where: string): Band => {
  const v = value(node, where);
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number")) {
    throw new Error(`tokens/covers.json: style.${where} must be [low, high]`);
  }
  return [v[0] as number, v[1] as number];
};

function readRule(id: string, raw: Record<string, Record<string, unknown>>): StyleRule {
  const at = (key: string) => raw[key];
  const chroma = at("chroma") ?? {};
  const flip = at("flip");
  const night = at("night");
  return {
    hue: num(at("hue"), `${id}.hue`),
    keep: num(at("keep"), `${id}.keep`),
    spread: num(at("spread"), `${id}.spread`),
    cap: num(at("cap"), `${id}.cap`),
    chroma: {
      scale: num(chroma.scale, `${id}.chroma.scale`),
      add: num(chroma.add, `${id}.chroma.add`),
      max: num(chroma.max, `${id}.chroma.max`),
      floorBelow: num(chroma["floor-below"], `${id}.chroma.floor-below`),
      floor: num(chroma.floor, `${id}.chroma.floor`),
    },
    ...(flip
      ? {
          flip: {
            light: band(flip.light, `${id}.flip.light`),
            dark: band(flip.dark, `${id}.flip.dark`),
          },
        }
      : {}),
    ...(night
      ? {
          night: {
            below: num(night.below, `${id}.night.below`),
            hue: num(night.hue, `${id}.night.hue`),
            chroma: num(night.chroma, `${id}.night.chroma`),
          },
        }
      : {}),
  };
}

/** One rule per style in `tokens/covers.json`. Default has none and draws as the month dressed it. */
export const STYLE_RULES: ReadonlyMap<string, StyleRule> = new Map(
  Object.entries(tokens.style as unknown as Record<string, unknown>)
    .filter(([id]) => !id.startsWith("$"))
    .map(([id, raw]) => [id, readRule(id, raw as Record<string, Record<string, unknown>>)]),
);

const clamp = (x: number, low: number, high: number): number => Math.min(high, Math.max(low, x));
/** CSS `mod()`: the result takes the sign of the divisor. */
const mod = (x: number, by: number): number => ((x % by) + by) % by;

/**
 * The hue a set of colours centres on: the mean of their hues weighted by chroma, so a grey among
 * them does not pull it. A month's centre is that of its scheme; a cover before the monthly style
 * uses its own palette.
 */
export function hueCentre(colors: readonly string[]): number {
  let x = 0;
  let y = 0;
  for (const hex of colors) {
    const { c, h } = hexToOklch(hex);
    x += c * Math.cos((h * Math.PI) / 180);
    y += c * Math.sin((h * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function flipped(l: number, rule: StyleRule, mode: CoverMode): number {
  if (!rule.flip) return l;
  const [low, high] = rule.flip[mode];
  return low + (1 - l) * (high - low);
}

/**
 * Type and figures keep their lightness gap to the ground, and 10% more: OKLab lightness is not
 * relative luminance, so a hue that moves a figure toward blue would leave a 3:1 pair just under it.
 * The same number is in cover.css.
 */
export const HOLD_GAP = 1.1;

export interface StyleInput {
  /** The colour the month dressed, in the theme drawn. */
  base: Oklch;
  /** The month's hue centre. */
  centre: number;
  mode: CoverMode;
  /**
   * For type and figures: the lightness of the ground they sit on, as the month dressed it. The style
   * keeps the lightness gap they had to it, so they read as before without a search for contrast.
   */
  ground?: number;
  /** A reader's hue, added to the style's anchor. */
  shift?: number;
  /** Move hue and chroma only: for a tint whose lightness the page has already tuned (the ambient light). */
  hueOnly?: boolean;
}

/**
 * One colour as the style draws it: the formula `cover.css` writes in CSS, step for step (including
 * its 1000x steps for the night and floor switches), so a browser and this file agree to rounding.
 */
export function styleColour(rule: StyleRule, input: StyleInput): Oklch {
  const { base, centre, mode, ground, shift = 0, hueOnly = false } = input;
  const k = rule.chroma;
  const lightness = hueOnly ? base.l : flipped(base.l, rule, mode);
  const night = rule.night && !hueOnly ? clamp((rule.night.below - lightness) * 1000, 0, 1) : 0;
  const floor = clamp((k.floorBelow - base.c) * 1000, 0, 1);
  const anchor = rule.hue + shift;
  const tilt = clamp((mod(base.h - centre + 180, 360) - 180) * rule.spread, -rule.cap, rule.cap);
  const hue = anchor + rule.keep * (mod(centre - anchor + 180, 360) - 180) + tilt;
  const chroma = floor * k.floor + (1 - floor) * Math.min(k.max, base.c * k.scale + k.add);
  let l = lightness;
  if (ground !== undefined) {
    const to = flipped(ground, rule, mode);
    const gap = Math.max(Math.abs(lightness - to), Math.abs(base.l - ground)) * HOLD_GAP;
    l = clamp(to + clamp((lightness - to) * 1000, -1, 1) * gap, 0, 1);
  }
  const n = rule.night;
  return {
    l,
    c: n ? night * n.chroma + (1 - night) * chroma : chroma,
    h: n ? night * (n.hue + shift) + (1 - night) * hue : hue,
  };
}

/** `styleColour` as the hex a browser would draw (chroma reduced into sRGB at the same lightness). */
export function styleHex(rule: StyleRule, input: StyleInput): string {
  return oklchToHex(styleColour(rule, input));
}

/**
 * A hex colour as a style draws it, or itself under Default or a style with no rule. For page code that
 * draws with colours outside the cover (the ambient light): hue and chroma follow the style, the
 * lightness stays, since the page has tuned it to its theme.
 */
export function restyleHex(
  style: string | undefined,
  hex: string,
  centre: number,
  mode: CoverMode,
  shift = 0,
): string {
  const rule = style === undefined ? undefined : STYLE_RULES.get(style);
  if (!rule) return hex;
  return styleHex(rule, { base: hexToOklch(hex), centre, mode, shift, hueOnly: true });
}
