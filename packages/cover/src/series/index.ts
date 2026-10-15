import { hash32 } from "../prng.js";
import { n } from "../svg.js";
import type { Template, Variant } from "../types.js";
import { DAILY_STYLES } from "./daily/index.js";
import { STYLES as ON_DEMAND_STYLES } from "./ondemand/index.js";
import { WEEKLY_STYLES } from "./weekly/index.js";

/**
 * The three monthly cover series, each with its own set of styles: dailies on a dark or light
 * ground, paper weeklies, and on-demand briefings and episodes on a matte. A cover's seed picks its
 * style, so a cover never changes once drawn.
 */
export type Series = "daily" | "weekly" | "on-demand";

export const SERIES_STYLES: Record<Series, readonly Template[]> = {
  daily: DAILY_STYLES.map((s) => s.draw),
  weekly: WEEKLY_STYLES.map((s) => s.draw),
  // On-demand styles are drawn in 1024 units; scale them to the canvas like the others.
  "on-demand": ON_DEMAND_STYLES.map((s) => (ctx) => {
    const out = s.fn(ctx);
    return { ...out, body: `<g transform="scale(${n(ctx.u, 4)})">${out.body}</g>` };
  }),
};

export function seriesOf(variant: Variant): Series {
  if (variant === "weekly") return "weekly";
  if (variant === "plate") return "on-demand";
  return "daily";
}

export function seriesStyle(series: Series, seed: number): Template {
  const styles = SERIES_STYLES[series];
  const style = styles[hash32(`style:${seed}`) % styles.length];
  if (!style) throw new Error(`Cover series "${series}" has no styles`);
  return style;
}
