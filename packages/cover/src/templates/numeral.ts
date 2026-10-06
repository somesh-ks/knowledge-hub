import { contrastRatio } from "../color.js";
import { numeralMarkup, textMarkup, WORDMARK } from "../lockup.js";
import { CAP_HEIGHT, measureNumeral } from "../metrics.js";
import { rectPath } from "../svg.js";
import type { Ctx, Palette, Rect, Template } from "../types.js";

/**
 * Numeral: the day number set enormous and cropped by the frame, over flat blocks of color. The
 * numeral is one solid color and every block behind it is chosen to hold at least 3:1 against it,
 * so a number the size of the canvas is still read at a glance. A small ground plate carries the
 * month and the wordmark.
 */

type Layout = "split" | "bands" | "corner" | "column";
type Mode = "ink" | "knockout" | "accent";

/** Minimum contrast between the numeral and any block behind it (large-text threshold). */
const BLOCK_CONTRAST = 3;

interface Block {
  rect: Rect;
  fill: string;
}

/** Fills that sit well behind a numeral of the given color, best-known first. */
function candidates(pal: Palette, numeralColor: string, mode: Mode): string[] {
  const pool =
    mode === "ink"
      ? [pal.ground, pal.field, pal.accent, pal.shade]
      : mode === "accent"
        ? [pal.ground, pal.field, pal.text, pal.shade]
        : [pal.accent, pal.shade, pal.text];
  return pool.filter(
    (fill, i) => pool.indexOf(fill) === i && contrastRatio(numeralColor, fill) >= BLOCK_CONTRAST,
  );
}

function numeralColorFor(pal: Palette, mode: Mode): string {
  if (mode === "ink") return pal.text;
  if (mode === "accent") return pal.accent;
  return pal.ground;
}

function buildBlocks(ctx: Ctx, layout: Layout, fills: string[]): Block[] {
  const { rng, w, h } = ctx;
  const flip = rng.chance(0.5);
  const mirrorX = (r: Rect): Rect => (flip ? { ...r, x: w - r.x - r.w } : r);
  const order = [...fills];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const fill = (i: number): string => order[i % order.length] as string;
  switch (layout) {
    case "split": {
      const x = w * rng.range(0.34, 0.66);
      const y = h * rng.range(0.3, 0.7);
      return [
        { rect: mirrorX({ x: 0, y: 0, w: x, h }), fill: fill(0) },
        { rect: mirrorX({ x, y: 0, w: w - x, h: y }), fill: fill(1) },
        { rect: mirrorX({ x, y, w: w - x, h: h - y }), fill: fill(2) },
      ];
    }
    case "bands": {
      const a = h * rng.range(0.22, 0.42);
      const b = h * rng.range(0.55, 0.8);
      return [
        { rect: { x: 0, y: 0, w, h: a }, fill: fill(0) },
        { rect: { x: 0, y: a, w, h: b - a }, fill: fill(1) },
        { rect: { x: 0, y: b, w, h: h - b }, fill: fill(2) },
      ];
    }
    case "corner": {
      const bw = w * rng.range(0.52, 0.74);
      const bh = h * rng.range(0.5, 0.74);
      return [
        { rect: { x: 0, y: 0, w, h }, fill: fill(0) },
        { rect: mirrorX({ x: w - bw, y: 0, w: bw, h: bh }), fill: fill(1) },
        {
          rect: mirrorX({ x: 0, y: h * rng.range(0.5, 0.7), w: w * rng.range(0.3, 0.5), h }),
          fill: fill(2),
        },
      ];
    }
    default: {
      const cx = w * rng.range(0.3, 0.52);
      const cw = w * rng.range(0.22, 0.36);
      return [
        { rect: { x: 0, y: 0, w, h }, fill: fill(0) },
        { rect: mirrorX({ x: cx, y: 0, w: cw, h }), fill: fill(1) },
        {
          rect: mirrorX({ x: cx + cw, y: h * rng.range(0.4, 0.6), w: w - cx - cw, h }),
          fill: fill(2),
        },
      ];
    }
  }
}

export const numeral: Template = (ctx) => {
  const { rng, w, h, u, pal, day } = ctx;
  const modes = (["ink", "knockout", "accent"] as const).filter(
    (m) => candidates(pal, numeralColorFor(pal, m), m).length >= 2,
  );
  const mode = rng.weighted<Mode>(modes, (m) => (m === "accent" ? 3 : 4));
  const color = numeralColorFor(pal, mode);
  const fills = candidates(pal, color, mode);
  const layout = rng.weighted<Layout>(["split", "bands", "corner", "column"], () => 1);
  const blocks = buildBlocks(ctx, layout, fills);

  const digits = String(day);
  const weight = 900;
  const unit = measureNumeral(digits, weight, 1000, -40);

  // Plate in a top corner, opposite the side the numeral bleeds off.
  const plateLeft = ctx.corner === "bl" || ctx.corner === "tl";
  const monthSize = 44 * u;
  const markSize = 30 * u;
  const monthCap = CAP_HEIGHT * monthSize;
  const markCap = CAP_HEIGHT * markSize;
  const padding = 30 * u;
  const textWidth = Math.max(
    ctx.monthName.length * 0.58 * monthSize,
    WORDMARK.length * 0.6 * markSize,
  );
  const plate: Rect = {
    x: plateLeft ? ctx.margin - padding : w - ctx.margin + padding - (textWidth + padding * 2),
    y: ctx.margin - padding,
    w: textWidth + padding * 2,
    h: padding * 2 + monthCap + 24 * u + markCap,
  };

  // Size the numeral: fill most of the width, bleed off one side and the bottom, clear the plate.
  const bleedX = rng.range(0.03, 0.09);
  const bleedY = rng.range(0.02, 0.08);
  const fitWidth = ((1 + bleedX) * w) / (unit.ink / 1000);
  const fitHeight = (h * (1 + bleedY) - (plate.y + plate.h + 28 * u)) / CAP_HEIGHT;
  const fontSize = Math.max(Math.min(fitWidth, fitHeight), h * 0.62);
  const tracking = -0.04 * fontSize;
  const run = measureNumeral(digits, weight, fontSize, tracking);
  const baseline = h * (1 + bleedY);
  const x = plateLeft
    ? w + bleedX * run.ink - run.advance + run.right
    : -bleedX * run.ink - run.left;

  const flat = blocks.map((b) => `<path d="${rectPath(b.rect)}" fill="${b.fill}"/>`).join("");
  const big = numeralMarkup({ digits, x, baseline, size: fontSize, tracking, weight }, color);

  const textX = plate.x + padding;
  const monthY = plate.y + padding + monthCap;
  const plateMarkup =
    `<path d="${rectPath(plate)}" fill="${pal.ground}"/>` +
    textMarkup({
      text: ctx.monthName,
      x: textX - 2 * u,
      y: monthY,
      size: monthSize,
      weight: 500,
      fill: pal.text,
    }) +
    textMarkup({
      text: WORDMARK,
      x: textX - u,
      y: monthY + 22 * u + markCap,
      size: markSize,
      weight: 500,
      fill: pal.text,
      spacing: 0.02 * markSize,
    });
  return { body: flat + big + plateMarkup, lockup: "own" };
};
