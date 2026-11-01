import { readFileSync } from "node:fs";
import { create } from "fontkitten";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { n } from "./svg.js";

/**
 * Cover lettering as outlines. A cover in the page is vector (D311), and a page that waits for a font
 * to draw the date on every cover would flash; so each `<text>` of a cover is replaced by a run of
 * references to one shared sheet of glyph outlines (`GLYPH_SHEET_PATH`), cut from the same Schibsted
 * Grotesk files the raster covers use. The sheet is one cached file; a cover carries only the
 * positions. Kerning is not applied (the covers set digits one by one and month names at one weight).
 */
export const GLYPH_SHEET_PATH = "/covers/glyphs.svg";

const WEIGHT_NAMES = { 500: "Medium", 700: "Bold", 900: "Black" } as const;
export type GlyphWeight = keyof typeof WEIGHT_NAMES;
const WEIGHTS = Object.keys(WEIGHT_NAMES).map(Number) as GlyphWeight[];

/** The characters a cover prints: digits, the week letter, month names, the signature, a dash. */
const CHARACTERS = "0123456789W–-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

type Font = Extract<ReturnType<typeof create>, { glyphForCodePoint: unknown }>;
const fonts = new Map<GlyphWeight, Font>();

function fontFor(weight: number): Font {
  const known = WEIGHT_NAMES[weight as GlyphWeight];
  if (!known) throw new Error(`No glyph outlines for font weight ${weight}`);
  const cached = fonts.get(weight as GlyphWeight);
  if (cached) return cached;
  const file = RESVG_FONT_OPTIONS.fontFiles.find((path) => path.endsWith(`-${known}.ttf`));
  if (!file) throw new Error(`Font file for weight ${weight} is not configured`);
  const font = create(readFileSync(file));
  if (!("glyphForCodePoint" in font)) throw new Error(`${file} is a font collection`);
  fonts.set(weight as GlyphWeight, font);
  return font;
}

const id = (weight: number, char: string): string =>
  `g${weight / 100}-${(char.codePointAt(0) ?? 0).toString(16)}`;

/** The sheet: one `<path id>` for each character in each weight, in font units with y up. */
export function glyphSheet(): string {
  const paths: string[] = [];
  for (const weight of WEIGHTS) {
    const font = fontFor(weight);
    for (const char of CHARACTERS) {
      const glyph = font.glyphForCodePoint(char.codePointAt(0) ?? 0);
      paths.push(`<path id="${id(weight, char)}" d="${glyph.path.toSVG()}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg">${paths.join("")}</svg>`;
}

const TEXT = /<text ([^>]*)>([^<]*)<\/text>/g;

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
}

/**
 * Replaces each `<text>` of an SVG with a group of glyph references at the pen positions the text
 * would have, keeping its `fill`. The group's colour reaches the outlines by inheritance.
 */
export function outlineText(svg: string): string {
  return svg.replace(TEXT, (_match, attrs: string, content: string) => {
    const weight = Number(attr(attrs, "font-weight") ?? 400);
    const size = Number(attr(attrs, "font-size"));
    const font = fontFor(weight);
    const scale = size / font.unitsPerEm;
    const spacing = Number(attr(attrs, "letter-spacing") ?? 0);
    const chars = [...content.replaceAll("&amp;", "&")];
    const advances = chars.map(
      (char) => font.glyphForCodePoint(char.codePointAt(0) ?? 0).advanceWidth * scale + spacing,
    );
    const total = advances.reduce((sum, width) => sum + width, 0) - spacing;
    let pen = Number(attr(attrs, "x") ?? 0);
    if (attr(attrs, "text-anchor") === "end") pen -= total;
    const y = Number(attr(attrs, "y") ?? 0);
    const uses = chars.flatMap((char, index) => {
      const at = pen;
      pen += advances[index] ?? 0;
      if (char === " ") return [];
      if (!CHARACTERS.includes(char)) throw new Error(`No glyph outline for "${char}"`);
      return [
        `<use href="${GLYPH_SHEET_PATH}#${id(weight, char)}" transform="matrix(${n(scale, 5)} 0 0 ${n(-scale, 5)} ${n(at)} ${n(y)})"/>`,
      ];
    });
    const fill = attr(attrs, "fill");
    // The signature is the one lettering a small cover leaves out; the page shows it by this mark.
    const mark = content === "Singularity" ? ' data-mark=""' : "";
    return `<g${mark}${fill ? ` fill="${fill}"` : ""}>${uses.join("")}</g>`;
  });
}
