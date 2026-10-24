import { daysBetween, longDate, stockholmDate, TIME_ZONE } from "@singularity/core";

/**
 * The long date as a title on screen: "Wednesday 7 October" with a non-breaking space between the
 * day and the month, so a title that wraps never leaves "7" on one line and "October" on the next.
 * Text that leaves the page (a share, the media session, the document title) keeps `longDate`.
 */
export function longDateTitle(date: string): string {
  return longDate(date).replace(/(\d) /, "$1\u00a0");
}

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

export { longDate };

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

/** A piece of a headline, and whether it must stay on one line. */
export interface HeadlinePart {
  text: string;
  nowrap: boolean;
}

/** A hyphenated word short enough to keep whole on the narrowest line. */
const HYPHENATED = /[^\s-]+(?:-[^\s-]+)+/g;
const NOWRAP_MAX = 24;

/**
 * A headline split so its hyphenated words ("mid-range", "high-speed") can be kept whole: balanced
 * wrapping otherwise breaks at the hyphen ("mid- / range"). Plain text parts, so the page escapes
 * them as it does any text; only words up to 24 characters are held, so nothing overflows a phone.
 */
export function headlineParts(text: string): HeadlinePart[] {
  const parts: HeadlinePart[] = [];
  let at = 0;
  for (const match of text.matchAll(HYPHENATED)) {
    const start = match.index ?? 0;
    if (match[0].length > NOWRAP_MAX) continue;
    if (start > at) parts.push({ text: text.slice(at, start), nowrap: false });
    parts.push({ text: match[0], nowrap: true });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), nowrap: false });
  return parts;
}

/**
 * "Made on 7 October 2026 at 07:13": when a briefing or an episode was written, in the site's time
 * zone, the one the schedule runs in. Shown at the foot of its page (owner, 2026-10-24).
 */
export function madeAt(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
  return `Made on ${day} at ${time}`;
}
