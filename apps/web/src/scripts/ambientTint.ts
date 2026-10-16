import { clampToGamut, hexToOklch, oklchToHex } from "../../../../packages/cover/src/color";
import type { Swatch } from "../../../../packages/cover/src/swatches";

/**
 * Server side only: the light is the colours a cover shows, read from its drawn image
 * (coverSwatches), each pressed to a lightness that suits the page. On the light theme a pale tint,
 * on the dark theme a mid tone; hue and chroma stay the cover's own, up to a cap.
 */
export const NEUTRAL_CHROMA = 0.03;
export const LIGHT = { l: 0.89, maxC: 0.09 } as const;
export const DARK = { l: 0.56, maxC: 0.2 } as const;

/** A swatch darker than this with no colour to speak of is ink or shadow, and gives no light. */
const SHADOW_L = 0.35;

/** How much a colour draws the eye: its area, and far more its chroma. */
const salience = (swatch: Swatch) => swatch.share * (0.2 + 10 * hexToOklch(swatch.hex).c);

/**
 * The three colours of the light, as a cover shows them: its largest colour that gives light first,
 * behind the cover, then the two that catch the eye most. On a monthly cover the paper takes
 * nine tenths of the area and the spot colour a few hundredths, so area alone would light the page
 * in paper and ink and lose the red the eye remembers.
 */
export function lightColors(swatches: readonly Swatch[]): [string, string, string] {
  const glows = (s: Swatch) => {
    const c = hexToOklch(s.hex);
    return c.l >= SHADOW_L || c.c >= NEUTRAL_CHROMA;
  };
  // A cover that is mostly black ink lights the page in its colours, not in grey.
  const lit = swatches.filter(glows);
  const [main, ...rest] = lit.length > 0 ? lit : swatches;
  if (!main) return ["#808080", "#808080", "#808080"];
  const [b = main, c = b] = rest.sort((x, y) => salience(y) - salience(x));
  return [main.hex, b.hex, c.hex];
}

/** One colour of the light at the lightness the theme can carry under its text. */
export function tint(hex: string, mode: "light" | "dark"): string {
  const target = mode === "light" ? LIGHT : DARK;
  const { c, h } = hexToOklch(hex);
  return oklchToHex(clampToGamut({ l: target.l, c: Math.min(c, target.maxC), h }));
}

export function tintColors(
  swatches: readonly Swatch[],
  mode: "light" | "dark",
): [string, string, string] {
  const [a, b, c] = lightColors(swatches);
  return [tint(a, mode), tint(b, mode), tint(c, mode)];
}
