import { FONT_STACK } from "./fonts.js";
import { CAP_HEIGHT, measureNumeral, type NumeralWeight } from "./metrics.js";
import { escapeXml, n } from "./svg.js";
import type { Corner, Palette, Rect } from "./types.js";

/** The one fixed piece of typography on every cover: day numeral, month and the wordmark. */

export const MARGIN_UNITS = 88;
export const WORDMARK = "Dispatch";

const NUMERAL_SIZE = 236;
const NUMERAL_WEIGHT: NumeralWeight = 900;
const NUMERAL_TRACKING = -0.04;
const MONTH_SIZE = 44;
const MARK_SIZE = 30;
/** Average lowercase advance as a fraction of the em; only used to size knockout boxes. */
const AVERAGE_ADVANCE = 0.58;

export interface LockupLayout {
  /** Ink box of numeral plus month. */
  box: Rect;
  /** Ink box of the wordmark, in the opposite corner. */
  markBox: Rect;
  markup: (pal: Palette) => string;
  markOnly: (pal: Palette) => string;
}

interface NumeralPlacement {
  digits: string;
  x: number;
  baseline: number;
  size: number;
  tracking: number;
  weight: NumeralWeight;
}

/** Digits as individual text elements at exact pen positions, so no renderer can re-space them. */
export function numeralMarkup(p: NumeralPlacement, fill: string): string {
  let pen = p.x;
  const out: string[] = [];
  for (const digit of p.digits) {
    out.push(
      `<text x="${n(pen)}" y="${n(p.baseline)}" font-family="${FONT_STACK}" font-weight="${p.weight}" font-size="${n(p.size)}" fill="${fill}">${escapeXml(digit)}</text>`,
    );
    pen += measureNumeral(digit, p.weight, p.size, 0).advance + p.tracking;
  }
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
 * Places numeral, month and wordmark. The numeral and month sit in `corner`; the wordmark takes the
 * diagonal opposite, so the two bits of type balance each other across the composition.
 */
export function layoutLockup(
  w: number,
  h: number,
  u: number,
  corner: Corner,
  day: number,
  monthName: string,
  margin: number,
): LockupLayout {
  const bottom = corner === "bl" || corner === "br";
  const right = corner === "br" || corner === "tr";
  const size = NUMERAL_SIZE * u;
  const tracking = NUMERAL_TRACKING * size;
  const digits = String(day);
  const run = measureNumeral(digits, NUMERAL_WEIGHT, size, tracking);
  const capHeight = CAP_HEIGHT * size;
  const monthSize = MONTH_SIZE * u;
  const monthCap = CAP_HEIGHT * monthSize;
  const gap = 34 * u;

  const numeralBaseline = bottom ? h - margin - monthCap - gap : margin + capHeight;
  const monthBaseline = bottom ? h - margin : numeralBaseline + gap + monthCap;
  const numeralX = right ? w - margin - run.advance + run.right : margin - run.left;
  const monthX = right ? w - margin : margin - 2 * u;
  const monthWidth = monthName.length * AVERAGE_ADVANCE * monthSize;

  const inkWidth = Math.max(run.ink, monthWidth);
  const box: Rect = {
    x: right ? w - margin - inkWidth : margin,
    y: bottom ? numeralBaseline - capHeight : margin,
    w: inkWidth,
    h: capHeight + gap + monthCap,
  };

  const markSize = MARK_SIZE * u;
  const markCap = CAP_HEIGHT * markSize;
  const markWidth = WORDMARK.length * AVERAGE_ADVANCE * markSize;
  const markRight = !right;
  const markBaseline = bottom ? margin + markCap : h - margin;
  const markBox: Rect = {
    x: markRight ? w - margin - markWidth : margin,
    y: markBaseline - markCap,
    w: markWidth,
    h: markCap,
  };
  const markMarkup = (fill: string): string =>
    textMarkup({
      text: WORDMARK,
      x: markRight ? w - margin : margin - 1 * u,
      y: markBaseline,
      size: markSize,
      weight: 500,
      fill,
      anchor: markRight ? "end" : "start",
      spacing: 0.02 * markSize,
    });

  const dateMarkup = (fill: string): string =>
    numeralMarkup(
      { digits, x: numeralX, baseline: numeralBaseline, size, tracking, weight: NUMERAL_WEIGHT },
      fill,
    ) +
    textMarkup({
      text: monthName,
      x: monthX,
      y: monthBaseline,
      size: monthSize,
      weight: 500,
      fill,
      anchor: right ? "end" : "start",
    });

  return {
    box,
    markBox,
    markup: (pal) => dateMarkup(pal.text) + markMarkup(pal.text),
    markOnly: (pal) => markMarkup(pal.text),
  };
}
