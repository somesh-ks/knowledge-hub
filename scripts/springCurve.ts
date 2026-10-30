/**
 * Draws a spring as a CSS `linear()` curve, so the tokens carry real physics and no animation
 * library. The model is a unit mass on a spring: `stiffness` is k, `damping` is the damping ratio
 * (1 is critical, below 1 overshoots). It is the parameterisation Material 3 Expressive publishes
 * for its motion scheme, so a spec value maps to a token one to one.
 *
 *   npx tsx scripts/springCurve.ts            prints the six expressive tokens as JSON
 *
 * The output is pasted into `tokens/tokens.json` (ease.* and duration.*) and checked by
 * `buildTokens.test.ts`, which re-derives each curve from the stiffness and damping recorded in
 * the token's extensions.
 */

export interface SpringParams {
  stiffness: number;
  /** Damping ratio: 1 is critically damped, below 1 overshoots. */
  damping: number;
}

/** Fraction of the way to the target at `seconds` after a step input. */
export function stepResponse({ stiffness, damping }: SpringParams, seconds: number): number {
  // An overdamped spring has its own response; no token needs one, so a ratio above 1 is refused
  // rather than drawn as the critical curve.
  if (damping > 1) throw new Error(`Damping ratio ${damping} is overdamped; use 1 or less`);
  const omega = Math.sqrt(stiffness);
  if (damping === 1) return 1 - Math.exp(-omega * seconds) * (1 + omega * seconds);
  const decay = damping * omega;
  const damped = omega * Math.sqrt(1 - damping * damping);
  return (
    1 -
    Math.exp(-decay * seconds) *
      (Math.cos(damped * seconds) + (decay / damped) * Math.sin(damped * seconds))
  );
}

/** First time after which the spring stays within `tolerance` of its target. */
export function settleSeconds(params: SpringParams, tolerance = 0.002): number {
  const step = 0.001;
  let last = 0;
  for (let t = 0; t < 5; t += step) {
    if (Math.abs(stepResponse(params, t) - 1) > tolerance) last = t;
  }
  return last + step;
}

export interface SpringCurve {
  /** CSS `linear()` value. */
  easing: string;
  /** Time the curve covers, in whole milliseconds. */
  durationMs: number;
  /** Highest value reached, as a fraction of the travel (1 means no overshoot). */
  peak: number;
}

export function springCurve(params: SpringParams, samples: number): SpringCurve {
  const settle = settleSeconds(params);
  const durationMs = Math.ceil((settle * 1000) / 10) * 10;
  const points: number[] = [];
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const value = stepResponse(params, (i / (samples - 1)) * (durationMs / 1000));
    peak = Math.max(peak, value);
    points.push(Number(value.toFixed(4)));
  }
  points[0] = 0;
  points[points.length - 1] = 1;
  return { easing: `linear(${points.join(", ")})`, durationMs, peak: Number(peak.toFixed(4)) };
}

/**
 * Material 3 Expressive's motion scheme. Spatial springs move things (position, size, shape) and
 * may overshoot; effects springs fade and recolour and never do.
 */
export const EXPRESSIVE_SPRINGS = {
  "spatial-fast": { stiffness: 800, damping: 0.6 },
  "spatial-default": { stiffness: 380, damping: 0.8 },
  "spatial-slow": { stiffness: 200, damping: 0.8 },
  "effects-fast": { stiffness: 3800, damping: 1 },
  "effects-default": { stiffness: 1600, damping: 1 },
  "effects-slow": { stiffness: 800, damping: 1 },
} as const satisfies Record<string, SpringParams>;

const isMain = process.argv[1]?.endsWith("springCurve.ts") === true;
if (isMain) {
  const out: Record<string, SpringCurve & SpringParams> = {};
  for (const [name, params] of Object.entries(EXPRESSIVE_SPRINGS)) {
    out[name] = { ...params, ...springCurve(params, name.startsWith("spatial") ? 36 : 24) };
  }
  console.log(JSON.stringify(out, null, 2));
}
