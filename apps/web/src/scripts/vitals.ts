/**
 * Real-user Web Vitals: each page's LCP, INP and CLS, measured with the browser's own
 * PerformanceObserver and sent once to /api/report (server/report.ts keeps them for `dispatch
 * health`) when the page is hidden or a soft navigation replaces it. The next page starts afresh, so
 * one page's shifts and interactions are never credited to another; a soft navigation has no LCP.
 * app.ts loads this at idle, so it is not first-load script; the observers ask for buffered entries,
 * so what happened before it loaded still counts. A metric the browser does not measure (Safari has
 * no layout-shift) is left out. Half of all pages report (SAMPLE_RATE): the store writes each sample
 * and stops at a daily cap (vitalsStore.ts), which this spreads across the day.
 */

import { addInteraction, addShift, type PageVitals, pageReport, startPage } from "./vitalsMeasure";

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

const SAMPLE_RATE = 0.5;

let vitals: PageVitals = startPage(location.pathname);
let sampled = Math.random() < SAMPLE_RATE;
let sent = false;

/** Each observer's not yet delivered entries, taken so a leaving page counts all of its own. */
const flushes: Array<() => void> = [];

const observe = (
  type: string,
  take: (entries: PerformanceEntryList) => void,
  extra: Record<string, number> = {},
): void => {
  try {
    const observer = new PerformanceObserver((list) => take(list.getEntries()));
    observer.observe({ type, buffered: true, ...extra });
    flushes.push(() => take(observer.takeRecords()));
  } catch {
    // Not supported here.
  }
};

observe("largest-contentful-paint", (entries) => {
  const last = entries.at(-1);
  if (last) vitals.lcp = Math.round(last.startTime);
});

observe("layout-shift", (entries) => {
  for (const shift of entries as LayoutShift[]) {
    if (!shift.hadRecentInput) addShift(vitals, shift.startTime, shift.value);
  }
});

observe(
  "event",
  (entries) => {
    for (const event of entries as PerformanceEventTiming[]) {
      if (event.interactionId) addInteraction(vitals, event.duration);
    }
  },
  { durationThreshold: 40 },
);

const send = (): void => {
  for (const flush of flushes) flush();
  const body = pageReport(vitals);
  if (sent || !sampled || body === null) return;
  sent = true;
  navigator.sendBeacon?.("/api/report", body);
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") send();
});
addEventListener("pagehide", send);
// A soft navigation: the page that is leaving reports, and the next one is measured on its own.
document.addEventListener("astro:before-swap", (event) => {
  send();
  vitals = startPage((event as Event & { to?: URL }).to?.pathname ?? location.pathname);
  sampled = Math.random() < SAMPLE_RATE;
  sent = false;
});
