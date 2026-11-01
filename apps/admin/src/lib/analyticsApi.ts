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
    // Three asks: the totals, the visitors who came by a shared link, then the events. A link's
    // `?ref=share` is stored as the utm_source (Simple Analytics treats ref, source and utm_source as
    // one), so its visitors are a filtered ask, not a line in the referrers list.
    const [stats, shareStats, events] = await Promise.all([
      ask(query({ fields: "pageviews,visitors" })),
      ask(query({ fields: "visitors", utm_source: "share" })),
      ask(query({ events: LOOP_EVENTS.join(",") })),
    ]);
    return { status: 200, body: countsFrom(stats, shareStats, events) };
  } catch {
    return { status: 502, body: { error: "analytics_unavailable" } };
  }
}
