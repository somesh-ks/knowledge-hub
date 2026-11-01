import { hexToOklch } from "./color.js";
import { coverColors, parseDate } from "./context.js";
import { outlineText } from "./glyphs.js";
import { getPalette } from "./palettes.js";
import { type CoverSvgOptions, renderCoverSvg } from "./render.js";
import { isMonthly, schemeFor } from "./season.js";
import { hueCentre } from "./style.js";
import type { CoverMeta, CoverSpec } from "./types.js";

/**
 * A cover for the page, not for a file (D311). The same drawing as the raster cover, as one small
 * SVG whose colours are not painted but named: each distinct colour is a slot (`k0`, `k1`, ...) that
 * carries its numbers for both themes, and `cover.css` turns the slot into a colour: the month's own
 * in Default, the style's math over it in any other. Nothing is drawn per style, so a new style or a
 * reader's hue costs no cover. The lettering is outlines from the glyph sheet, so no font is awaited.
 */

/** The slots a cover may use; `cover.css` names this many. */
export const COVER_SLOTS = 8;

const PAINT = /(fill|stroke)="(#[0-9a-fA-F]{6})"/g;

/** The month's hue centre: its scheme's, or the palette's own before the monthly style (D311). */
export function coverCentre(spec: CoverSpec, meta: CoverMeta): number {
  if (isMonthly(meta.date)) {
    const { year, month } = parseDate(meta.date);
    return hueCentre(schemeFor(year, month).colors);
  }
  const palette = getPalette(spec.palette);
  return hueCentre([palette.ground, palette.accent, palette.text]);
}

const lightness = (hex: string): string => hexToOklch(hex).l.toFixed(4);

/** The numbers of one slot in one theme, as the custom properties `cover.css` reads. */
function numbers(index: number, hex: string, suffix: "" | "d"): string {
  const { l, c, h } = hexToOklch(hex);
  return `--k${index}${suffix}:${hex.toLowerCase()};--l${index}${suffix}:${l.toFixed(4)};--x${index}${suffix}:${c.toFixed(4)};--h${index}${suffix}:${h.toFixed(2)}`;
}

export function renderLiveCoverSvg(
  spec: CoverSpec,
  meta: CoverMeta,
  options: CoverSvgOptions = {},
): string {
  const light = outlineText(renderCoverSvg(spec, { ...meta, mode: "light" }, options));
  const dark = outlineText(renderCoverSvg(spec, { ...meta, mode: "dark" }, options));
  const lightPaints = [...light.matchAll(PAINT)];
  const darkPaints = [...dark.matchAll(PAINT)];
  if (
    lightPaints.length === 0 ||
    lightPaints.length !== darkPaints.length ||
    lightPaints.some((paint, i) => paint[1] !== darkPaints[i]?.[1])
  ) {
    throw new Error("A cover's light and dark drawings must differ only in colour");
  }

  const slots = new Map<string, number>();
  const pairs: Array<[string, string]> = [];
  const slotOf = (lightHex: string, darkHex: string): number => {
    const key = `${lightHex.toLowerCase()}|${darkHex.toLowerCase()}`;
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = pairs.length;
      slots.set(key, slot);
      pairs.push([lightHex, darkHex]);
    }
    return slot;
  };

  // Type holds its lightness gap to the ground, and so does the figure when it sits on the ground.
  const typeHexes = new Set(
    [...light.matchAll(/<g fill="(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]?.toLowerCase()),
  );
  const figure = coverColors(spec, { ...meta, mode: "light" }).accent.toLowerCase();

  const groundHex = lightPaints[0]?.[2] ?? "";
  const groundDark = darkPaints[0]?.[2] ?? "";
  let index = 0;
  const body = light.replace(PAINT, (_paint, kind: string) => {
    const [, , lightHex] = lightPaints[index] ?? [];
    const [, , darkHex] = darkPaints[index] ?? [];
    index += 1;
    if (!lightHex || !darkHex) throw new Error("Cover paint lost its colour");
    const slot = slotOf(lightHex, darkHex);
    const lowered = lightHex.toLowerCase();
    const held =
      lowered !== groundHex.toLowerCase() && (typeHexes.has(lowered) || lowered === figure);
    const role = kind === "fill" ? "k" : "s";
    return `class="${role} ${role}${slot}${held ? " h" : ""}"`;
  });
  if (slots.size > COVER_SLOTS) {
    throw new Error(`A cover uses ${slots.size} colours; cover.css names ${COVER_SLOTS}`);
  }
  if (/<[^>]*class="[^"]*"[^>]*class="/.test(body)) {
    throw new Error("A cover element is painted twice; it needs one class attribute");
  }

  const vars = [
    `--ctr:${coverCentre(spec, meta).toFixed(2)}`,
    `--gl:${lightness(groundHex)}`,
    `--gld:${lightness(groundDark)}`,
    ...pairs.flatMap(([lightHex, darkHex], slot) => [
      numbers(slot, lightHex, ""),
      numbers(slot, darkHex, "d"),
    ]),
  ].join(";");
  return body
    .replace(/<title>.*?<\/title>/, "")
    .replace(
      /<svg ([^>]*?) width="\d+" height="\d+" role="img" aria-label="[^"]*">/,
      `<svg $1 class="cover-art" aria-hidden="true" focusable="false" style="${vars}">`,
    );
}
