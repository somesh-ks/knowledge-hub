import tokens from "../../../tokens/covers.json" with { type: "json" };
import { contrastRatio, hexToOklch, mixHex, type Oklch, oklchToHex, parseOklch } from "./color.js";
import type { Palette, Tone } from "./types.js";

interface TokenColor {
  $value: string;
}

interface TokenPalette {
  $extensions: { dispatch: { name: string; tone: Tone } };
  ground: TokenColor;
  accent: TokenColor;
  text: TokenColor;
}

/** The roles a palette authors. The quiet field tint and the mid shade are derived from them. */
const ROLES = ["ground", "accent", "text"] as const;

/** How far the field tint and the mid shade sit from the ground toward the figure, in OKLab. */
const FIELD_MIX = 0.16;
const SHADE_MIX = 0.5;

function isTokenColor(value: unknown): value is TokenColor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { $value?: unknown }).$value === "string"
  );
}

function readPalette(id: string, raw: unknown): TokenPalette {
  const palette = raw as Partial<TokenPalette> | undefined;
  const meta = palette?.$extensions?.dispatch;
  if (!palette || !meta || !ROLES.every((role) => isTokenColor(palette[role]))) {
    throw new Error(`tokens/covers.json: palette "${id}" is missing a role or its metadata`);
  }
  if (meta.tone !== "light" && meta.tone !== "dark") {
    throw new Error(`tokens/covers.json: palette "${id}" needs a tone of light or dark`);
  }
  return palette as TokenPalette;
}

/**
 * The most chroma any cover colour may carry. A grid of covers past it glares (D119), and every
 * monthly scheme draws only from these palettes, so the cap holds for every month to come.
 */
export const MAX_CHROMA = 0.12;

const OKLCH_BY_ID = new Map<string, Record<(typeof ROLES)[number], Oklch>>();

const PALETTES: readonly Palette[] = Object.entries(tokens.cover)
  .filter(([key]) => !key.startsWith("$"))
  .map(([id, raw]) => {
    const palette = readPalette(id, raw);
    const oklch = Object.fromEntries(
      ROLES.map((role) => [role, parseOklch(palette[role].$value)]),
    ) as Record<(typeof ROLES)[number], Oklch>;
    for (const role of ROLES) {
      if (oklch[role].c > MAX_CHROMA) {
        throw new Error(
          `tokens/covers.json: palette "${id}" ${role} has chroma ${oklch[role].c}, above ${MAX_CHROMA}`,
        );
      }
    }
    OKLCH_BY_ID.set(id, oklch);
    const ground = oklchToHex(oklch.ground);
    const accent = oklchToHex(oklch.accent);
    return {
      id,
      name: palette.$extensions.dispatch.name,
      tone: palette.$extensions.dispatch.tone,
      ground,
      field: mixHex(ground, accent, FIELD_MIX),
      shade: mixHex(ground, accent, SHADE_MIX),
      accent,
      text: oklchToHex(oklch.text),
    };
  });

export const PALETTE_IDS: readonly string[] = PALETTES.map((p) => p.id);

/** Palettes that suit the weekly record: deep grounds, so the matte reads as a boxed set. */
export const DARK_PALETTE_IDS: readonly string[] = PALETTES.filter((p) => p.tone === "dark").map(
  (p) => p.id,
);

export function allPalettes(): readonly Palette[] {
  return PALETTES;
}

export function getPalette(id: string): Palette {
  const palette = PALETTES.find((p) => p.id === id);
  if (!palette) throw new Error(`Unknown cover palette "${id}"`);
  return palette;
}

/** The reader's surfaces, from docs/prototype/reader-prototype.html, for accent legibility checks. */
export const SURFACE_LIGHT = oklchToHex({ l: 0.976, c: 0.006, h: 230 });
export const SURFACE_DARK = oklchToHex({ l: 0.17, c: 0.02, h: 250 });

/** Non-text UI contrast target for a progress bar or tint (WCAG 1.4.11). */
const UI_CONTRAST = 3;

/** Moves lightness toward `direction` in small steps until the color reads on `surface`. */
function fitAccent(accent: Oklch, surface: string, direction: 1 | -1): string {
  let candidate = { ...accent };
  for (let step = 0; step < 100; step += 1) {
    const hex = oklchToHex(candidate);
    if (contrastRatio(hex, surface) >= UI_CONTRAST) return hex;
    candidate = { ...candidate, l: candidate.l + direction * 0.01 };
  }
  return oklchToHex(candidate);
}

/**
 * Colors the player takes from a cover: an accent for light and dark surfaces, each at 3:1 or better
 * against the reader's surface, and the cover's ground for the placeholder block before the PNG loads.
 */
export function paletteAccent(paletteId: string): { light: string; dark: string; bg: string } {
  const palette = getPalette(paletteId);
  const roles = OKLCH_BY_ID.get(paletteId);
  if (!roles) throw new Error(`Unknown cover palette "${paletteId}"`);
  // The ground is now the loud color on most covers, so the player tints with whichever of ground
  // and figure carries more chroma; a pale or black figure would turn the progress bar grey.
  const accent = roles.ground.c > roles.accent.c ? roles.ground : roles.accent;
  return {
    light: fitAccent(accent, SURFACE_LIGHT, -1),
    dark: fitAccent(accent, SURFACE_DARK, 1),
    bg: palette.ground,
  };
}

/** Distance between two palettes' grounds in OKLab: how different they look side by side in a grid. */
export function groundDistance(a: string, b: string): number {
  const x = hexToOklch(getPalette(a).ground);
  const y = hexToOklch(getPalette(b).ground);
  const rad = Math.PI / 180;
  return Math.hypot(
    x.l - y.l,
    x.c * Math.cos(x.h * rad) - y.c * Math.cos(y.h * rad),
    x.c * Math.sin(x.h * rad) - y.c * Math.sin(y.h * rad),
  );
}

/** Plain black and white, the last resort for type: one of them always clears 4.5:1 on any color. */
const PAPER = "#ffffff";
const INK = "#000000";

/** Lockup text on the inverted ground: the first of these that reads at 4.5:1 on the figure color. */
function inverseText(palette: Palette): string {
  const candidates = [palette.ground, palette.text, PAPER, INK];
  const best = candidates.find((c) => contrastRatio(c, palette.accent) >= LOCKUP_CONTRAST);
  return best ?? PAPER;
}

/** Minimum contrast for the date and wordmark against the flat ground behind them. */
export const LOCKUP_CONTRAST = 4.5;

/**
 * A user-made episode is the same record pressed the other way round: the figure color becomes the
 * ground and the ground becomes the figure, so it sits apart from briefings in any grid.
 */
export function invertPalette(palette: Palette): Palette {
  return {
    ...palette,
    ground: palette.accent,
    accent: palette.ground,
    field: mixHex(palette.accent, palette.ground, FIELD_MIX),
    shade: mixHex(palette.accent, palette.ground, SHADE_MIX),
    text: inverseText(palette),
  };
}
