import { daysBetween, longDate, stockholmDate } from "@dispatch/core";

/** "m:ss" for a duration in milliseconds. Rounds to whole seconds, never shows a negative. */
export function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** First word of the long date, "Wednesday". */
function weekdayName(date: string): string {
  return longDate(date).split(" ")[0] ?? "";
}

/**
 * The "since" part of the hero's first meta line. A window that opened within the last week reads
 * as a weekday ("since Monday"); a longer one names the day ("since 28 September").
 */
export function sinceLabel(windowFrom: string, digestDate: string): string {
  const fromDate = stockholmDate(new Date(windowFrom));
  const days = daysBetween(fromDate, digestDate);
  if (days <= 0) return "today";
  if (days <= 6) return `since ${weekdayName(fromDate)}`;
  return `since ${longDate(fromDate).split(" ").slice(1).join(" ")}`;
}

export function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** "2026-10" for a YYYY-MM-DD date. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" });

/** "October" for a "2026-10" key. */
export function monthName(monthKey: string): string {
  return monthFormat.format(new Date(`${monthKey}-15T12:00:00Z`));
}

export { longDate };
