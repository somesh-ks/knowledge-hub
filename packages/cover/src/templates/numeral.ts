import { numeralMarkup } from "../lockup.js";
import { CAP_HEIGHT, measureNumeral } from "../metrics.js";
import type { Template } from "../types.js";

const WEIGHT = 900;
const TRACKING = -0.03;

/**
 * The day of the month as the whole picture: a numeral set so large it bleeds off the frame. It is the
 * date, so the renderer adds only the wordmark and the month, in the top corners.
 */
export const numeral: Template = (ctx) => {
  const { w, u, rng, pal, numeral, lockup } = ctx;
  const digits = numeral;
  const unit = measureNumeral(digits, WEIGHT, 1000, TRACKING * 1000);
  // Fit the ink to the frame's width with a little bleed, then cap the height so a lone digit stops
  // short of the top line.
  const topLine = Math.max(lockup.mark.y + lockup.mark.h, lockup.month.y + lockup.month.h) + 64 * u;
  const bleedX = w * rng.range(0, 0.05);
  const fitWidth = ((w + bleedX * 2) / unit.ink) * 1000;
  const bleedY = rng.chance(0.7) ? w * rng.range(0.02, 0.07) : -ctx.margin;
  const fitHeight = (w + bleedY - topLine) / CAP_HEIGHT;
  const size = Math.min(fitWidth, fitHeight);

  const run = measureNumeral(digits, WEIGHT, size, TRACKING * size);
  const align = rng.pick(["left", "right", "centre"] as const);
  const inkLeft =
    align === "left" ? -bleedX : align === "right" ? w + bleedX - run.ink : (w - run.ink) / 2;
  const placement = {
    digits,
    x: inkLeft - run.left,
    baseline: w + bleedY,
    size,
    tracking: TRACKING * size,
    weight: WEIGHT,
  } as const;

  const mode =
    digits.length > 1
      ? rng.pick(["solid", "solid", "twotone", "outline"] as const)
      : rng.pick(["solid", "outline"] as const);
  if (mode === "outline") {
    const stroke = `fill="none" stroke="${pal.accent}" stroke-width="${(size * 0.035).toFixed(1)}" stroke-linejoin="round"`;
    return { body: numeralMarkup(placement, stroke) };
  }
  const paints =
    mode === "twotone" ? [`fill="${pal.accent}"`, `fill="${pal.text}"`] : `fill="${pal.accent}"`;
  return { body: numeralMarkup(placement, paints) };
};
