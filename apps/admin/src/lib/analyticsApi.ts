import { type Counts, countsFrom, LOOP_EVENTS, WINDOW } from "./analyticsStats.js";

/**
 * What the Analytics page asks of its function (api/analytics.ts): the week's counts from Simple
 * Analytics' Stats API. The handler takes the call as `ask`, so a test drives it without the network.
 * The key stays on the server: the page never holds it.
 */
export interface AnalyticsAnswer {
  status: number;
  body: Counts | { error: string };
}

/** Asks Simple Analytics for one path's JSON; throws when it does not answer with one. */
export type Ask = (query: string) => Promise<unknown>;

const query = (fields: Record<string, string>): string =>
  new URLSearchParams({
    version: "6",
    start: WINDOW.start,
    end: WINDOW.end,
    timezone: WINDOW.timezone,
    info: "false",
    ...fields,
  }).toString();

export async function handleAnalytics(method: string, ask: Ask | null): Promise<AnalyticsAnswer> {
  if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
  if (ask === null) return { status: 503, body: { error: "no_key" } };
  try {
    // Two asks: the totals and referrers, then the events (a filter or a field list apart).
    const [stats, events] = await Promise.all([
      ask(query({ fields: "pageviews,visitors,referrers", limit: "100" })),
      ask(query({ events: LOOP_EVENTS.join(",") })),
    ]);
    return { status: 200, body: countsFrom(stats, events) };
  } catch {
    return { status: 502, body: { error: "analytics_unavailable" } };
  }
}
