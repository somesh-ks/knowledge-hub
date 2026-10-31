/**
 * What the Analytics page shows (docs/specs/analytics.md, "The loops and their numbers"): the week's
 * counts from Simple Analytics, and the four ratios that say whether each loop turns. The function
 * (api/analytics.ts) gathers the counts; this file holds what is made of them, so a test can drive it.
 */

/** The events the loops are read from, by their names in the reader (apps/web/src/lib/analytics.ts). */
export const LOOP_EVENTS = [
  "share",
  "listen_start",
  "listen_half",
  "listen_complete",
  "create_episode",
] as const;
export type LoopEvent = (typeof LOOP_EVENTS)[number];

/** The window: the last seven days, today included, counted on Stockholm's days (D239). */
export const WINDOW = { days: 7, start: "today-6d", end: "today", timezone: "Europe/Stockholm" };

/** The counts the function returns. */
export interface Counts {
  days: number;
  visitors: number;
  pageviews: number;
  /** Visitors whose referrer is `share`: a link someone sent (`?ref=share`). */
  share_visitors: number;
  events: Record<LoopEvent, number>;
}

export interface Figure {
  value: string;
  line: string;
}

/** A ratio, or "No data" when there is nothing to divide by: never NaN, never Infinity. */
const ratio = (part: number, whole: number, as: "times" | "percent"): string => {
  if (!(whole > 0)) return "No data";
  const share = part / whole;
  return as === "percent" ? `${Math.round(share * 100)}%` : share.toFixed(2);
};

/** One reading for each of the four loops, in the order the spec lists them. */
export function loopFigures(counts: Counts): Record<string, Figure> {
  const { events } = counts;
  return {
    shares_per_visitor: {
      value: ratio(events.share, counts.visitors, "times"),
      line: `${events.share} shares, ${counts.visitors} visitors`,
    },
    visits_per_share: {
      value: ratio(counts.share_visitors, events.share, "times"),
      line: `${counts.share_visitors} visits from shared links`,
    },
    listen_through: {
      value: ratio(events.listen_half, events.listen_start, "percent"),
      line: `${events.listen_half} past half, ${events.listen_start} started`,
    },
    completion: {
      value: ratio(events.listen_complete, events.listen_start, "percent"),
      line: `${events.listen_complete} finished, ${events.listen_start} started`,
    },
  };
}

/** Simple Analytics' answer, read for what the page needs; a field it left out counts as none. */
export function countsFrom(stats: unknown, shareStats: unknown, events: unknown): Counts {
  const field = (source: unknown, key: string): unknown =>
    source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
  const number = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

  const named = new Map<string, number>();
  const list = field(events, "events");
  if (Array.isArray(list)) {
    for (const entry of list)
      named.set(String(field(entry, "name")), number(field(entry, "total")));
  }
  return {
    days: WINDOW.days,
    visitors: number(field(stats, "visitors")),
    pageviews: number(field(stats, "pageviews")),
    share_visitors: number(field(shareStats, "visitors")),
    events: Object.fromEntries(LOOP_EVENTS.map((name) => [name, named.get(name) ?? 0])) as Record<
      LoopEvent,
      number
    >,
  };
}
