/**
 * Digit metrics for Schibsted Grotesk, read from the static instances with fontTools:
 * [advance, xMin, xMax] in font units. Used to place and crop numerals without a text layout engine.
 */
export const UNITS_PER_EM = 2048;
/** Cap height and digit height, in em. */
export const CAP_HEIGHT = 1440 / UNITS_PER_EM;

type Digit = readonly [advance: number, xMin: number, xMax: number];

const DIGITS = {
  700: {
    "0": [1294, 77, 1217],
    "1": [828, 51, 686],
    "2": [1222, 51, 1140],
    "3": [1234, 47, 1170],
    "4": [1285, 46, 1240],
    "5": [1262, 68, 1198],
    "6": [1261, 75, 1189],
    "7": [1163, 40, 1124],
    "8": [1254, 65, 1189],
    "9": [1263, 73, 1187],
  },
  900: {
    "0": [1327, 59, 1268],
    "1": [926, 44, 801],
    "2": [1261, 32, 1201],
    "3": [1278, 27, 1229],
    "4": [1355, 34, 1320],
    "5": [1320, 56, 1271],
    "6": [1294, 57, 1244],
    "7": [1223, 29, 1196],
    "8": [1308, 49, 1259],
    "9": [1300, 51, 1243],
  },
} as const satisfies Record<number, Record<string, Digit>>;

export type NumeralWeight = keyof typeof DIGITS;

export interface NumeralRun {
  /** Pen advance of the whole run, including tracking, in px. */
  advance: number;
  /** Distance from the pen origin to the first glyph's ink, in px. */
  left: number;
  /** Distance from the last glyph's ink to the end of the advance, in px. */
  right: number;
  /** Ink width in px. */
  ink: number;
}

/** Measures a run of digits at `size` px with `tracking` px added between glyphs. */
export function measureNumeral(
  text: string,
  weight: NumeralWeight,
  size: number,
  tracking: number,
): NumeralRun {
  const table: Record<string, Digit> = DIGITS[weight];
  const glyphs = [...text].map((ch) => {
    const digit = table[ch];
    if (!digit) throw new Error(`No digit metrics for "${ch}"`);
    return digit;
  });
  const scale = size / UNITS_PER_EM;
  const first = glyphs[0];
  const last = glyphs[glyphs.length - 1];
  if (!first || !last) throw new Error("Empty numeral");
  const advance = glyphs.reduce((sum, g) => sum + g[0] * scale, 0) + tracking * (glyphs.length - 1);
  const left = first[1] * scale;
  const right = (last[0] - last[2]) * scale;
  return { advance, left, right, ink: advance - left - right };
}
