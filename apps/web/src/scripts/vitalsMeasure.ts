/**
 * The arithmetic of scripts/vitals.ts, kept apart from its observers so it is tested without a
 * browser: one page's LCP, INP and CLS, started afresh for each page a soft navigation shows.
 */

export interface PageVitals {
  page: string;
  lcp?: number;
  inp?: number;
  /** The largest CLS session window so far. */
  cls?: number;
  /** The open session window: its sum, and its first and last shift, in ms since time origin. */
  window: { value: number; start: number; last: number };
}

export function startPage(page: string): PageVitals {
  return {
    page,
    window: { value: 0, start: Number.NEGATIVE_INFINITY, last: Number.NEGATIVE_INFINITY },
  };
}

/**
 * CLS is the largest session window (web.dev): the first shift opens one, and a shift more than 1 s
 * after the last, or more than 5 s after the window's first, opens the next.
 */
export function addShift(vitals: PageVitals, startTime: number, value: number): void {
  const open = vitals.window;
  if (startTime - open.last > 1000 || startTime - open.start > 5000) {
    open.value = 0;
    open.start = startTime;
  }
  open.value += value;
  open.last = startTime;
  vitals.cls = Math.max(vitals.cls ?? 0, Math.round(open.value * 10_000) / 10_000);
}

/** INP as the slowest interaction: a page here has few, so the slowest is the 98th percentile. */
export function addInteraction(vitals: PageVitals, duration: number): void {
  vitals.inp = Math.max(vitals.inp ?? 0, duration);
}

/** The page's report body, or null when nothing was measured on it. */
export function pageReport(vitals: PageVitals): string | null {
  const { page, lcp, inp, cls } = vitals;
  if (lcp === undefined && inp === undefined && cls === undefined) return null;
  return JSON.stringify({ kind: "vitals", page, lcp, inp, cls });
}
