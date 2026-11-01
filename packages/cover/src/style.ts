import tokens from "../../../tokens/covers.json" with { type: "json" };
import { contrastRatio, hexToOklch, type Oklch, oklchToHex } from "./color.js";
import { type CoverMode, holdContrast } from "./mode.js";
import { LOCKUP_CONTRAST } from "./palettes.js";
import type { Palette } from "./types.js";

/**
 * How a style (Settings, Style) redraws a cover (D311). The rule is numbers in `tokens/covers.json`;
 * this applies it to a cover that the month has already dressed and the theme has already toned, so
 * every month, every palette and every future style follows one path. Default has no rule and draws
 * as dressed.
 */

type Band = readonly [number, number];

interface StyleRule {
  hue: number;
  keep: number;
  spread: number;
  cap: number;
  chroma: { scale: number; add: number; max: number; floorBelow: number; floor: number };
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

const RULES = new Map<string, StyleRule>(
  Object.entries(tokens.style as unknown as Record<string, unknown>)
    .filter(([id]) => !id.startsWith("$"))
    .map(([id, raw]) => [id, readRule(id, raw as Record<string, Record<string, unknown>>)]),
);

/** The styles a cover can be drawn in: Default, which has no rule, and one per rule in covers.json. */
export const COVER_STYLES = ["default", ...RULES.keys()] as const;
export type CoverStyle = string;

export function isCoverStyle(style: string): boolean {
  return style === "default" || RULES.has(style);
}

/** The signed shortest arc from `from` to `to`, in degrees, -180 to 180. */
const arc = (from: number, to: number): number => ((((to - from + 180) % 360) + 360) % 360) - 180;

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

/** One colour as the style draws it. `centre` is the month's hue centre. */
function styleColour(hex: string, rule: StyleRule, centre: number, mode: CoverMode): string {
  const c: Oklch = hexToOklch(hex);
  const [low, high] = rule.flip?.[mode] ?? [0, 1];
  const l = rule.flip ? low + (1 - c.l) * (high - low) : c.l;
  const night = rule.night !== undefined && l < rule.night.below;
  if (rule.night && night) return oklchToHex({ l, c: rule.night.chroma, h: rule.night.hue });
  const tilt = Math.max(-rule.cap, Math.min(rule.cap, arc(centre, c.h) * rule.spread));
  const h = rule.hue + rule.keep * arc(rule.hue, centre) + tilt;
  const k = rule.chroma;
  const chroma = c.c < k.floorBelow ? k.floor : Math.min(k.max, c.c * k.scale + k.add);
  return oklchToHex({ l, c: chroma, h });
}

/** Moves `fg` until it reads on `bg` again, but only where the pair read before the style. */
function hold(fg: string, bg: string, was: [string, string], floor: number): string {
  return contrastRatio(was[0], was[1]) >= floor ? holdContrast(fg, bg, floor) : fg;
}

/**
 * A dressed cover in a style: every colour mapped, then the figure held at 3:1 and the type at 4.5:1
 * on their grounds where they were before. `ink` is the type colour a monthly cover prints (it is
 * the palette's own on an older one) and `matte` the flat ground of an on-demand cover.
 */
export function styleDress(
  dress: { pal: Palette; ink: string; matte?: string | undefined },
  style: CoverStyle | undefined,
  centre: number,
  mode: CoverMode,
): { pal: Palette; ink: string; matte?: string } {
  const rule = style === undefined ? undefined : RULES.get(style);
  if (!rule) return { ...dress, ...(dress.matte ? { matte: dress.matte } : {}) };
  const map = (hex: string) => styleColour(hex, rule, centre, mode);
  const { pal, ink, matte } = dress;
  const ground = map(pal.ground);
  const accent = hold(map(pal.accent), ground, [pal.accent, pal.ground], 3);
  const text = hold(map(pal.text), ground, [pal.text, pal.ground], LOCKUP_CONTRAST);
  const styledMatte = matte === undefined ? undefined : map(matte);
  const base = styledMatte ?? ground;
  const styledInk = hold(map(ink), base, [ink, matte ?? pal.ground], LOCKUP_CONTRAST);
  return {
    pal: { ...pal, ground, accent, text, field: map(pal.field), shade: map(pal.shade) },
    ink: styledInk,
    ...(styledMatte === undefined ? {} : { matte: styledMatte }),
  };
}

/**
 * The address segment of a cover drawn for a theme and a style: `dark` for Default, `dark-halloween`
 * for a style (D311). The page shows the one image that matches its theme and its style.
 */
export function coverLook(mode: CoverMode, style?: string): string {
  return style && style !== "default" ? `${mode}-${style}` : mode;
}

/** The theme and style a look names, or null for anything the build never drew. */
export function parseCoverLook(look: string): { mode: CoverMode; style: string } | null {
  const [mode, ...rest] = look.split("-");
  if (mode !== "light" && mode !== "dark") return null;
  const style = rest.length === 0 ? "default" : rest.join("-");
  return isCoverStyle(style) && !(rest.length > 0 && style === "default") ? { mode, style } : null;
}
