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
    W: [2113, 38, 2027],
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
    W: [2223, 20, 2165],
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

/** Advance widths in font units of the caption's characters: month names and week ranges in bold, the year in medium. */
const ADVANCES: Record<500 | 700, Record<string, number>> = {
  700: {
    A: 1512,
    B: 1391,
    C: 1469,
    D: 1508,
    E: 1240,
    F: 1197,
    G: 1496,
    H: 1542,
    I: 873,
    J: 1206,
    K: 1487,
    L: 1186,
    M: 1916,
    N: 1572,
    O: 1573,
    P: 1377,
    Q: 1573,
    R: 1411,
    S: 1328,
    T: 1411,
    U: 1470,
    V: 1462,
    W: 2065,
    X: 1506,
    Y: 1349,
    Z: 1299,
    a: 1221,
    b: 1286,
    c: 1193,
    d: 1285,
    e: 1222,
    f: 757,
    g: 1185,
    h: 1236,
    i: 582,
    j: 620,
    k: 1244,
    l: 610,
    m: 1870,
    n: 1264,
    o: 1251,
    p: 1287,
    q: 1286,
    r: 938,
    s: 1115,
    t: 778,
    u: 1264,
    v: 1238,
    w: 1803,
    x: 1242,
    y: 1247,
    z: 1111,
    "0": 1294,
    "1": 828,
    "2": 1222,
    "3": 1234,
    "4": 1285,
    "5": 1262,
    "6": 1261,
    "7": 1163,
    "8": 1254,
    "9": 1263,
    " ": 430,
    "–": 1024,
  },
  500: {
    "0": 1263,
    "1": 737,
    "2": 1186,
    "3": 1194,
    "4": 1221,
    "5": 1208,
    "6": 1230,
    "7": 1108,
    "8": 1205,
    "9": 1229,
    "–": 1024,
  },
};

/** Pen advance of `text` at `size` px, without kerning; for placing one text run after another. */
export function measureText(text: string, weight: 500 | 700, size: number): number {
  const table = ADVANCES[weight];
  return [...text].reduce((sum, ch) => {
    const advance = table[ch];
    if (advance === undefined) throw new Error(`No advance for "${ch}" at weight ${weight}`);
    return sum + (advance * size) / UNITS_PER_EM;
  }, 0);
}
