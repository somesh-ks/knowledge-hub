import type { Template } from "../../types.js";
import { frame, rect } from "./kit.js";

/**
 * An audio waveform across the page, mirrored about a centre line, with the played part in the
 * figure colour and the rest in shade. The cover for a thing you listen to says so.
 */
export const waveform: Template = (ctx) => {
  const { pal, rng } = ctx;
  const count = 30;
  const pitch = 30;
  const x0 = (1024 - count * pitch) / 2 + 4;
  const cy = 372;
  const played = rng.range(0.4, 0.68);
  const p1 = rng.range(0.6, 1.4);
  const p2 = rng.range(0.15, 0.4);
  const ph1 = rng.range(0, 6.28);
  const ph2 = rng.range(0, 6.28);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const swell = Math.sin(Math.PI * t) ** 0.7;
    const wobble =
      0.5 + 0.28 * Math.sin(t * 15 * p1 + ph1) + 0.22 * Math.sin(t * 31 * p2 * 3 + ph2);
    const half = Math.max(10, 200 * swell * Math.min(1, Math.max(0.12, wobble)));
    out.push(
      rect(x0 + i * pitch, cy - half, 18, half * 2, t <= played ? pal.accent : pal.shade, 9),
    );
  }
  return frame(ctx, out.join(""));
};
