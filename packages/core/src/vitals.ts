import { z } from "zod";

/**
 * Real-user Web Vitals (D139, hardening round 3). Each page load measures LCP, INP and CLS in the
 * browser and sends them to /api/report at page hide; the site keeps a day's samples in one public
 * Blob file, and `dispatch health` compares the last day's p75 to the "good" thresholds and to the
 * six days before it (eight day files).
 */

export const VITAL_METRICS = ["lcp", "inp", "cls"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

/** web.dev's "good" limits at the 75th percentile: LCP and INP in milliseconds, CLS unitless. */
export const VITAL_GOOD: Record<VitalMetric, number> = { lcp: 2500, inp: 200, cls: 0.1 };

/** Upper bounds a real measurement stays under; anything past is a broken or forged report. */
export const VITAL_MAX: Record<VitalMetric, number> = { lcp: 60_000, inp: 30_000, cls: 10 };

/** One day's file keeps at most this many samples, so a flood cannot grow it or its writes. */
export const VITALS_DAY_MAX_SAMPLES = 300;

export const VitalSample = z.object({
  /** Epoch milliseconds, by the function's clock. */
  at: z.number().int().nonnegative(),
  page: z.string().max(300),
  lcp: z.number().nonnegative().max(VITAL_MAX.lcp).optional(),
  inp: z.number().nonnegative().max(VITAL_MAX.inp).optional(),
  cls: z.number().nonnegative().max(VITAL_MAX.cls).optional(),
});
export type VitalSample = z.infer<typeof VitalSample>;

export const VitalsDay = z.object({
  version: z.literal(1),
  /** UTC day, YYYY-MM-DD. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  samples: z.array(VitalSample).max(VITALS_DAY_MAX_SAMPLES),
});
export type VitalsDay = z.infer<typeof VitalsDay>;

/** The Blob pathname of a UTC day's samples. */
export function vitalsPath(day: string): string {
  return `health/vitals-${day}.json`;
}

/** The 75th percentile (nearest rank) of a metric across samples, or null with none. */
export function p75(samples: readonly VitalSample[], metric: VitalMetric): number | null {
  const values = samples
    .map((sample) => sample[metric])
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  return values[Math.ceil(values.length * 0.75) - 1] ?? null;
}
