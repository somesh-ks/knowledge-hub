import tokens from "../../../tokens/covers.json" with { type: "json" };
import { contrastRatio, type Oklch, oklchToHex, parseOklch } from "./color.js";
import type { Palette, Tone } from "./types.js";

interface TokenColor {
  $value: string;
}

interface TokenPalette {
  $extensions: { dispatch: { name: string; tone: Tone } };
  ground: TokenColor;
  field: TokenColor;
  shade: TokenColor;
  accent: TokenColor;
  text: TokenColor;
}

const ROLES = ["ground", "field", "shade", "accent", "text"] as const;

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

const OKLCH_BY_ID = new Map<string, Record<(typeof ROLES)[number], Oklch>>();

const PALETTES: readonly Palette[] = Object.entries(tokens.cover)
  .filter(([key]) => !key.startsWith("$"))
  .map(([id, raw]) => {
    const palette = readPalette(id, raw);
    const oklch = Object.fromEntries(
      ROLES.map((role) => [role, parseOklch(palette[role].$value)]),
    ) as Record<(typeof ROLES)[number], Oklch>;
    OKLCH_BY_ID.set(id, oklch);
    return {
      id,
      name: palette.$extensions.dispatch.name,
      tone: palette.$extensions.dispatch.tone,
      ground: oklchToHex(oklch.ground),
      field: oklchToHex(oklch.field),
      shade: oklchToHex(oklch.shade),
      accent: oklchToHex(oklch.accent),
      text: oklchToHex(oklch.text),
    };
  });

export const PALETTE_IDS: readonly string[] = PALETTES.map((p) => p.id);

/** Palettes that suit the weekly record: dark grounds. */
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
  const accent = OKLCH_BY_ID.get(paletteId)?.accent;
  if (!accent) throw new Error(`Unknown cover palette "${paletteId}"`);
  return {
    light: fitAccent(accent, SURFACE_LIGHT, -1),
    dark: fitAccent(accent, SURFACE_DARK, 1),
    bg: palette.ground,
  };
}
