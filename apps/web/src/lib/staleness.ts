/**
 * Staleness of a briefing, computed in the browser: a static page cannot know what day it is when
 * someone opens it. No imports from @dispatch/core here, because this file ships to the client and
 * core pulls in Node modules.
 */

/** A digest is due about every second day, so more than three days old means a run was missed. */
export const STALE_AFTER_DAYS = 3;

const STOCKHOLM_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm",
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

export function staleTitle(age: number): string {
  return `This briefing is ${age} days old`;
}
