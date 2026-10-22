import { cumulativeLayoutShift, type LayoutShift, vitalPage } from "@dispatch/core/vitals";

/**
 * Field Web Vitals (D156): this page load's LCP, INP and CLS, read from the browser's own
 * PerformanceObserver and sent once, by beacon, to /api/report (server/vitals.ts) when the page is
 * first hidden. On a phone that is the moment an installed app goes to the background, which fires
 * no pagehide; pagehide is the fallback. app.ts loads this at idle, or at the first visibility change
 * if that comes sooner, on the production site alone. The observers ask for buffered entries, so
 * what happened before it loaded still counts.
 *
 * One report per page load, as CrUX counts them: the LCP of the page that loaded, and CLS and INP
 * over its life until that hide, moves inside the app included, under the route it loaded at (a
 * template, never an address). A paint after the page was first hidden is not its LCP (a tab opened
 * in the background). A metric the browser does not measure is left out (Safari has no layout-shift
 * or event timing). Besides the three numbers it sends the device class and the connection type.
 */

interface EventTiming extends PerformanceEntry {
  interactionId?: number;
}

let started = false;

export function startVitals(): void {
  if (started) return;
  started = true;
  let hiddenAt = Number.POSITIVE_INFINITY;
  const paints: number[] = [];
  const shifts: LayoutShift[] = [];
  /** Each interaction's longest event, by interaction id. */
  const interactions = new Map<number, number>();
  const measured = new Set<string>();
  const flushes: Array<() => void> = [];
  const observe = (
    type: string,
    take: (entry: PerformanceEntry) => void,
    extra: { durationThreshold?: number } = {},
  ): void => {
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach(take));
      observer.observe({ type, buffered: true, ...extra });
      measured.add(type);
      flushes.push(() => observer.takeRecords().forEach(take));
    } catch {
      // Not measured in this browser.
    }
  };
  observe("visibility-state", (entry) => {
    if (entry.name === "hidden") hiddenAt = Math.min(hiddenAt, entry.startTime);
  });
  observe("largest-contentful-paint", (entry) => paints.push(entry.startTime));
  observe("layout-shift", (entry) => shifts.push(entry as unknown as LayoutShift));
  observe(
    "event",
    (entry) => {
      const id = (entry as EventTiming).interactionId;
      if (id) interactions.set(id, Math.max(interactions.get(id) ?? 0, entry.duration));
    },
    { durationThreshold: 16 },
  );

  let sent = false;
  const send = (): void => {
    if (sent) return;
    sent = true;
    for (const flush of flushes) flush();
    // Without visibility-state entries, the earliest hide known is now.
    hiddenAt = Math.min(hiddenAt, performance.now());
    const lcp = paints.filter((at) => at < hiddenAt).pop();
    // INP: the slowest interaction, less one for every 50 (web.dev's 98th percentile). An interaction
    // too quick to be observed (under 16 ms, or under 104 ms before this loaded) counts as 0.
    const latencies = [...interactions.values()].sort((a, b) => b - a);
    const count =
      (performance as { interactionCount?: number }).interactionCount ?? latencies.length;
    const inp =
      count > 0 ? (latencies[Math.min(latencies.length - 1, Math.floor(count / 50))] ?? 0) : null;
    const cls = measured.has("layout-shift") ? cumulativeLayoutShift(shifts) : null;
    if (lcp === undefined && inp === null && cls === null) return;
    const landed = performance.getEntriesByType("navigation")[0]?.name;
    navigator.sendBeacon?.(
      "/api/report",
      JSON.stringify({
        kind: "vitals",
        page: vitalPage(landed ? new URL(landed).pathname : location.pathname),
        device: matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop",
        connection: (navigator as { connection?: { effectiveType?: string } }).connection
          ?.effectiveType,
        lcp: lcp === undefined ? undefined : Math.round(lcp),
        inp: inp === null ? undefined : Math.round(inp),
        cls: cls === null ? undefined : Math.round(cls * 10_000) / 10_000,
      }),
    );
  };
  if (document.visibilityState === "hidden") send();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send();
  });
  addEventListener("pagehide", send);
}
