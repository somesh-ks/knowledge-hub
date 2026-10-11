/**
 * Staleness of a briefing, computed in the browser: a static page cannot know what day it is when
 * someone opens it. No imports from @dispatch/core here, because this file ships to the client and
 * core pulls in Node modules.
 */

/** A digest is due about every second day, so more than three days old means a run was missed. */
export const STALE_AFTER_DAYS = 3;

/** The calendar a digest's date belongs to. */
export const STALE_TIME_ZONE = "Europe/Stockholm";

/** The stale banner's title; {days} is the age. */
export const STALE_TITLE = "This briefing is {days} days old";

const STOCKHOLM_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: STALE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Stockholm calendar date (YYYY-MM-DD) of an instant. */
export function todayInStockholm(now: Date = new Date()): string {
  return STOCKHOLM_DATE.format(now);
}

/** Whole calendar days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetweenDates(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The age in days when the digest is stale, otherwise null. */
export function staleAge(digestDate: string, today: string): number | null {
  const age = daysBetweenDates(digestDate, today);
  return age > STALE_AFTER_DAYS ? age : null;
}

/**
 * The first calendar day (YYYY-MM-DD) on which a digest of `digestDate` is stale. The build hands it
 * to the inline script that shows the banner before first paint (bannersInit.js), so the rule stays
 * here.
 */
export function staleFrom(digestDate: string): string {
  const first = Date.parse(`${digestDate}T00:00:00Z`) + (STALE_AFTER_DAYS + 1) * 86_400_000;
  return new Date(first).toISOString().slice(0, 10);
}

export function staleTitle(age: number): string {
  return STALE_TITLE.replace("{days}", String(age));
}
