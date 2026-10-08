import { TAU } from "../math.js";
import type { Template } from "../types.js";
import { rect } from "./kit.js";

/**
 * A waveform with a playhead: rounded bars whose heights follow a seeded envelope, the played part in
 * the figure color and the rest in a quiet shade. The one bar at the playhead takes the text color.
 */
export const dither: Template = (ctx) => {
  const { w, u, rng, pal, margin, quiet } = ctx;
  const date = quiet[0];
  const mark = quiet[1];
  const bars = rng.int(15, 27);
  const span = w - margin * 2;
  const pitch = span / bars;
  const width = pitch * rng.range(0.5, 0.66);

  const floor = (mark ? mark.y + mark.h : 0) + 48 * u;
  const ceiling = (date ? date.y : w) - 24 * u;
  const cy = rng.range(0.45, 0.55) * (floor + ceiling);
  const half = Math.min(cy - floor, ceiling - cy);

  // Three sines of different period and a little jitter: lively, never a flat comb.
  const phases = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)] as const;
  const periods = [rng.range(5, 9), rng.range(2.2, 3.6), rng.range(1.1, 1.7)] as const;
  const head = Math.floor(bars * rng.range(0.28, 0.72));

  const out: string[] = [];
  for (let i = 0; i < bars; i += 1) {
    const wave =
      0.5 +
      0.28 * Math.sin((i / periods[0]) * TAU + phases[0]) +
      0.16 * Math.sin((i / periods[1]) * TAU + phases[1]) +
      0.08 * Math.sin((i / periods[2]) * TAU + phases[2]);
    const level = Math.min(1, Math.max(0.08, wave + rng.range(-0.06, 0.06)));
    const height = Math.max(width, 2 * half * level);
    const color = i === head ? pal.text : i < head ? pal.accent : pal.shade;
    const x = margin + i * pitch + (pitch - width) / 2;
    out.push(rect(x, cy - height / 2, width, height, color, width / 2));
  }
  return { body: out.join("") };
};
