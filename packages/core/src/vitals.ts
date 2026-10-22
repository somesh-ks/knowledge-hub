/**
 * Field Web Vitals (D156): LCP, INP and CLS from real visits. The page measures them
 * (apps/web/src/scripts/vitals.ts), `/api/report` stores them in Neon for seven days
 * (packages/engine/src/store/vitalsStore.ts), and `dispatch health` judges each metric's 7-day p75
 * against Google's thresholds. No dependencies: the page's lazy chunk imports this too, and the lab
 * probe (scripts/perfMath.ts) shares its CLS.
 */

export const VITAL_METRICS = ["lcp", "inp", "cls"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

/**
 * Google's lines (web.dev/articles/vitals), LCP and INP in milliseconds, CLS unitless: a value at or
 * under the first is good, over the second is poor, between needs improvement.
 */
export const VITAL_THRESHOLDS: Record<VitalMetric, readonly [good: number, poor: number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
};

export type VitalRating = "good" | "needs-improvement" | "poor";

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

/** Past these a value is a broken or forged report, not a measurement, and is not stored. */
export const VITAL_MAX: Record<VitalMetric, number> = { lcp: 120_000, inp: 60_000, cls: 10 };

/** A coarse pointer is `mobile` (phones and tablets), anything else `desktop`. */
export const VITAL_DEVICES = ["mobile", "desktop"] as const;
export type VitalDevice = (typeof VITAL_DEVICES)[number];

/** The Network Information API's effective types (Chromium only; absent elsewhere). */
export const VITAL_CONNECTIONS = ["slow-2g", "2g", "3g", "4g"] as const;

const DYNAMIC_PAGE = /^\/(d|e|settings\/topics)\/[^/]+$/;
const NAMED_PAGE = /^\/(?:library|create|offline|analytics|settings(?:\/[a-z]+(?:-[a-z]+)*)?)$/;

/**
 * The page's route, never its address: a briefing, an episode or a topic is its template
 * (`/d/[id]`), a named page is its path, anything else (a 404's typed address) is `other`. The page
 * sends this and the server applies it again, so nothing else is ever stored.
 */
export function vitalPage(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (trimmed === "/") return "/";
  const dynamic = DYNAMIC_PAGE.exec(trimmed);
  if (dynamic) return `/${dynamic[1]}/[id]`;
  return NAMED_PAGE.test(trimmed) ? trimmed : "other";
}

export interface LayoutShift {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
}

/** A shift this long after the last one starts a new session window (web.dev's CLS). */
const SESSION_GAP_MS = 1000;
/** A session window never spans more than this. */
const SESSION_MAX_MS = 5000;

/** CLS: the largest session window's sum of layout shifts not caused by recent input. */
export function cumulativeLayoutShift(shifts: readonly LayoutShift[]): number {
  let worst = 0;
  let sum = 0;
  let first = Number.NEGATIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const counted = shifts.filter((each) => !each.hadRecentInput);
  for (const each of [...counted].sort((a, b) => a.startTime - b.startTime)) {
    if (each.startTime - last >= SESSION_GAP_MS || each.startTime - first >= SESSION_MAX_MS) {
      sum = 0;
      first = each.startTime;
    }
    sum += each.value;
    last = each.startTime;
    worst = Math.max(worst, sum);
  }
  return worst;
}
