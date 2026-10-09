import { clampToGamut, hexToOklch, oklchToHex } from "../../../../packages/cover/src/color";
import { ambientColors } from "./ambientPalette";

/**
 * Server side only: the light is each palette color's hue pressed to a lightness that suits the
 * page. On the light theme a pale, low-chroma tint (sky blue for a blue cover, amber for a yellow
 * one); on the dark theme a mid tone with its chroma kept. A near-neutral color has no hue to
 * give, so it is dropped when any other color can stand in.
 */
export const NEUTRAL_CHROMA = 0.03;
export const LIGHT = { l: 0.89, maxC: 0.09 } as const;
export const DARK = { l: 0.56, maxC: 0.2 } as const;

export function tintColors(
  ground: string,
  accent: string,
  shade: string,
  mode: "light" | "dark",
): [string, string, string] {
  const target = mode === "light" ? LIGHT : DARK;
  const all = ambientColors(ground, accent, shade).map((hex) => hexToOklch(hex));
  const colorful = all.filter((c) => c.c >= NEUTRAL_CHROMA);
  const use = (colorful.length > 0 ? colorful : all).map((c) =>
    oklchToHex(clampToGamut({ l: target.l, c: Math.min(c.c, target.maxC), h: c.h })),
  );
  return [use[0] ?? "#808080", use[1] ?? use[0] ?? "#808080", use[2] ?? use[0] ?? "#808080"];
}
