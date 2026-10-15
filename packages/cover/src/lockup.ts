import { FONT_STACK } from "./fonts.js";
import { CAP_HEIGHT, measureNumeral, measureText, type NumeralWeight } from "./metrics.js";
import { escapeXml, n } from "./svg.js";
import type { Palette, Rect } from "./types.js";

/** The one fixed piece of typography on every cover: day numeral, month, year and the wordmark. */

export const MARGIN_UNITS = 72;
export const WORDMARK = "Singularity";

/** The date is the loudest type on the cover: at 150px the numeral is still about 29px tall. */
const NUMERAL_SIZE = 264;
const NUMERAL_WEIGHT: NumeralWeight = 900;
const NUMERAL_TRACKING = -0.04;
const MONTH_SIZE = 46;
/** The wordmark is a signature, not a headline: small, medium weight, in the top corner. */
const MARK_SIZE = 26;
/** Average advance as a fraction of the em; only used to size ink boxes, with a little slack. */
/** Ascender and descender depth of the lowercase, in em, with a little slack. */
const ASCENT = 0.77;
const DESCENT = 0.24;
const MONTH_ADVANCE = 0.62;
const MARK_ADVANCE = 0.6;
/** The year follows the month on its line, a word space on and one weight lighter: there to read, quiet. */
const YEAR_WEIGHT = 500;
const YEAR_GAP = 0.36;

export interface NumeralPlacement {
  digits: string;
  x: number;
  baseline: number;
  size: number;
  tracking: number;
  weight: NumeralWeight;
}

export interface LockupLayout {
  /** Ink box of the date numeral plus month and year, bottom left. */
  date: Rect;
  /** Ink box of the wordmark, top left. */
  mark: Rect;
  /** Ink box of the month alone when it moves to the top right, for a numeral that is the art. */
  month: Rect;
  /** Standard lockup: numeral, month and wordmark (`wordmark` false leaves the signature out). */
  markup: (pal: Palette, wordmark?: boolean) => string;
  /** Wordmark top left and month top right, for covers whose art is the day numeral itself. */
  topLine: (pal: Palette, wordmark?: boolean) => string;
}

/**
 * Digits as individual text elements at exact pen positions, so no renderer can re-space them.
 * `paint` is a complete attribute string such as `fill="#fff"`, one per digit or one for all, so a
 * numeral can be two-tone or outlined.
 */
export function numeralMarkup(p: NumeralPlacement, paint: string | readonly string[]): string {
  let pen = p.x;
  const out: string[] = [];
  [...p.digits].forEach((digit, i) => {
    const attrs = typeof paint === "string" ? paint : (paint[i] ?? paint[0]);
    out.push(
      `<text x="${n(pen)}" y="${n(p.baseline)}" font-family="${FONT_STACK}" font-weight="${p.weight}" font-size="${n(p.size)}" ${attrs}>${escapeXml(digit)}</text>`,
    );
    pen += measureNumeral(digit, p.weight, p.size, 0).advance + p.tracking;
  });
  return out.join("");
}

export function textMarkup(options: {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  fill: string;
  anchor?: "start" | "end";
  spacing?: number;
}): string {
  const anchor = options.anchor === "end" ? ' text-anchor="end"' : "";
  const spacing = options.spacing ? ` letter-spacing="${n(options.spacing, 2)}"` : "";
  return `<text x="${n(options.x)}" y="${n(options.y)}" font-family="${FONT_STACK}" font-weight="${options.weight}" font-size="${n(options.size)}"${anchor}${spacing} fill="${options.fill}">${escapeXml(options.text)}</text>`;
}

/**
 * Places the date lockup. The numeral and month stack at the bottom left and the wordmark sits at the
 * top left, in the same place on every cover, so the covers read as one series whatever they draw.
 */
export function layoutLockup(
  w: number,
  h: number,
  u: number,
  day: number | string,
  monthName: string,
  margin: number,
  year = "",
): LockupLayout {
  const size = NUMERAL_SIZE * u;
  const tracking = NUMERAL_TRACKING * size;
  const digits = String(day);
  const run = measureNumeral(digits, NUMERAL_WEIGHT, size, tracking);
  const capHeight = CAP_HEIGHT * size;
  const monthSize = MONTH_SIZE * u;
  const monthCap = CAP_HEIGHT * monthSize;
  const gap = 30 * u;

  // Month names carry descenders (September, January), so the baseline rides above the margin by the
  // descender depth and the ink still ends inside it.
  const monthBaseline = h - margin - DESCENT * monthSize;
  const numeralBaseline = monthBaseline - monthCap - gap;
  const numeralX = margin - run.left;
  // The year's x comes from the month's measured advance; the box keeps the older estimate as a floor.
  const yearAt = (size: number): number => measureText(monthName, 700, size) + YEAR_GAP * size;
  const yearRun = (size: number): number =>
    year ? yearAt(size) + measureText(year, 500, size) : 0;
  const monthWidth = Math.max(monthName.length * MONTH_ADVANCE * monthSize, yearRun(monthSize));
  const dateWidth = Math.max(run.ink, monthWidth);
  // Round digits overshoot the cap line by a hair; the box leaves room for it.
  const overshoot = 0.025 * size;
  const date: Rect = {
    x: margin,
    y: numeralBaseline - capHeight - overshoot,
    w: dateWidth,
    h: capHeight + overshoot + gap + monthCap + DESCENT * monthSize,
  };

  const markSize = MARK_SIZE * u;
  // Ascenders (l, t) rise above cap height and the y and g descend, so the box is a full em of line.
  const markBaseline = margin + ASCENT * markSize;
  const mark: Rect = {
    x: margin,
    y: margin,
    w: WORDMARK.length * MARK_ADVANCE * markSize,
    h: (ASCENT + DESCENT) * markSize,
  };
  const markMarkup = (fill: string): string =>
    textMarkup({
      text: WORDMARK,
      x: margin - 1 * u,
      y: markBaseline,
      size: markSize,
      weight: 500,
      fill,
      spacing: 0.02 * markSize,
    });

  const topMonthSize = 40 * u;
  const topMonthWidth = Math.max(
    monthName.length * MONTH_ADVANCE * topMonthSize,
    yearRun(topMonthSize),
  );
  const yearMarkup = (fill: string, x: number, y: number, size: number, anchor?: "end"): string =>
    year ? textMarkup({ text: year, x, y, size, weight: YEAR_WEIGHT, fill, anchor }) : "";
  const topYearWidth = year ? measureText(year, 500, topMonthSize) + YEAR_GAP * topMonthSize : 0;
  const month: Rect = {
    x: w - margin - topMonthWidth,
    y: margin,
    w: topMonthWidth,
    h: (ASCENT + DESCENT) * topMonthSize,
  };

  return {
    date,
    mark,
    month,
    markup: (pal, wordmark = true) =>
      numeralMarkup(
        { digits, x: numeralX, baseline: numeralBaseline, size, tracking, weight: NUMERAL_WEIGHT },
        `fill="${pal.text}"`,
      ) +
      textMarkup({
        text: monthName,
        x: margin - 2 * u,
        y: monthBaseline,
        size: monthSize,
        weight: 700,
        fill: pal.text,
      }) +
      yearMarkup(pal.text, margin - 2 * u + yearAt(monthSize), monthBaseline, monthSize) +
      (wordmark ? markMarkup(pal.text) : ""),
    topLine: (pal, wordmark = true) =>
      (wordmark ? markMarkup(pal.text) : "") +
      textMarkup({
        text: monthName,
        x: w - margin - topYearWidth,
        y: margin + ASCENT * topMonthSize,
        size: topMonthSize,
        weight: 700,
        fill: pal.text,
        anchor: "end",
      }) +
      yearMarkup(pal.text, w - margin, margin + ASCENT * topMonthSize, topMonthSize, "end"),
  };
}
