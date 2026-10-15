import { numeralMarkup } from "../../lockup.js";
import { CAP_HEIGHT, measureNumeral } from "../../metrics.js";
import type { Template } from "../../types.js";
import { zone } from "./kit.js";

const WEIGHT = 900;
const TRACKING = -0.03;

/**
 * The day as a poster numeral, solid and cropped by the right edge, with a misregistered second
 * pass under it in the shade colour, like a two-colour print that slipped. Small date below, big
 * date above: the same fact at two sizes.
 */
export const numeralCrop: Template = (ctx) => {
  const { u, rng, pal, numeral } = ctx;
  const { left, dateTop, markBottom } = zone(ctx);
  const bleed = rng.range(10, 60);
  const unit = measureNumeral(numeral, WEIGHT, 1000, TRACKING * 1000);
  const fitWidth = ((1024 - left + bleed) / unit.ink) * 1000;
  const fitHeight = (dateTop - markBottom) / CAP_HEIGHT;
  const size = Math.min(fitWidth, fitHeight, 880);
  const run = measureNumeral(numeral, WEIGHT, size, TRACKING * size);
  const baseline = Math.min(dateTop, markBottom + CAP_HEIGHT * size + 120);
  const place = {
    digits: numeral,
    x: 1024 + bleed - run.ink - run.left,
    baseline,
    size,
    tracking: TRACKING * size,
    weight: WEIGHT,
  } as const;
  const off = 20;
  const back = numeralMarkup(
    { ...place, x: place.x - off, baseline: baseline + off },
    `fill="${pal.shade}"`,
  );
  const front = numeralMarkup(place, `fill="${pal.accent}"`);
  return { body: `<g transform="scale(${u})">${back}${front}</g>` };
};
