const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "1:26", or "1:02:05" past an hour. Whole seconds, floored, never negative. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

/** Splits a clock so a component can set the colon in its own fixed-width box. */
export function clockParts(totalSeconds: number): { before: string; after: string } {
  const text = formatClock(totalSeconds);
  const cut = text.lastIndexOf(":");
  return { before: text.slice(0, cut), after: text.slice(cut + 1) };
}

/**
 * The widest a clock up to `totalSeconds` gets, as zeros: "00:00" for a 12 minute track. Figures are
 * tabular, so zeros are as wide as any digits, and a hidden copy holds a live clock's width still.
 */
export function clockSizerParts(totalSeconds: number): { before: string; after: string } {
  const { before, after } = clockParts(totalSeconds);
  return { before: before.replace(/\d/g, "0"), after: after.replace(/\d/g, "0") };
}

export function formatRemaining(elapsedSeconds: number, durationSeconds: number): string {
  return `-${formatClock(Math.max(0, durationSeconds - elapsedSeconds))}`;
}

/** Digest ids start with their Stockholm date: "2026-10-07", "2026-10-04-weekly". */
export function dateFromDigestId(id: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(id);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Wednesday 7 October", the voice's date form. Falls back to the id when it is not a date. */
export function longDateFromDigestId(id: string): string {
  const date = dateFromDigestId(id);
  if (!date) return id;
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "October 2026", used as the album on the lock screen so a month of briefings groups together. */
export function monthLabelFromDate(isoDate: string): string {
  const date = dateFromDigestId(isoDate);
  if (!date) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
