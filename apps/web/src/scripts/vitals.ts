/**
 * Real-user Web Vitals: this page load's LCP, INP and CLS, measured with the browser's own
 * PerformanceObserver and sent once to /api/report when the page is hidden (server/report.ts keeps
 * them for `dispatch health`). app.ts loads this at idle, so it is not first-load script; the
 * observers ask for buffered entries, so what happened before it loaded still counts. A metric the
 * browser does not measure (Safari has no layout-shift) is left out.
 */

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

const measured: { lcp?: number; inp?: number; cls?: number } = {};
const page = location.pathname;

const observe = (
  type: string,
  take: (entries: PerformanceEntryList) => void,
  extra: Record<string, number> = {},
): void => {
  try {
    new PerformanceObserver((list) => take(list.getEntries())).observe({
      type,
      buffered: true,
      ...extra,
    });
  } catch {
    // Not supported here.
  }
};

observe("largest-contentful-paint", (entries) => {
  const last = entries.at(-1);
  if (last) measured.lcp = Math.round(last.startTime);
});

// CLS is the largest session window: shifts less than 1 s apart, 5 s at most (web.dev's definition).
let windowValue = 0;
let windowStart = 0;
let windowLast = 0;
observe("layout-shift", (entries) => {
  for (const shift of entries as LayoutShift[]) {
    if (shift.hadRecentInput) continue;
    if (shift.startTime - windowLast > 1000 || shift.startTime - windowStart > 5000) {
      windowValue = 0;
      windowStart = shift.startTime;
    }
    windowValue += shift.value;
    windowLast = shift.startTime;
    measured.cls = Math.max(measured.cls ?? 0, Math.round(windowValue * 10_000) / 10_000);
  }
});

// INP as the slowest interaction: a page load here has few, so the slowest is the 98th percentile.
observe(
  "event",
  (entries) => {
    for (const event of entries as PerformanceEventTiming[]) {
      if (event.interactionId) measured.inp = Math.max(measured.inp ?? 0, event.duration);
    }
  },
  { durationThreshold: 40 },
);

let sent = false;
const send = (): void => {
  if (sent || Object.keys(measured).length === 0) return;
  sent = true;
  navigator.sendBeacon?.("/api/report", JSON.stringify({ kind: "vitals", page, ...measured }));
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") send();
});
addEventListener("pagehide", send);

/** A module, so app.ts can load it with import(). */
export {};
