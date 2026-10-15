/**
 * Calendar rules for the covers. All arithmetic is UTC on the date string alone, so a
 * cover never depends on the machine's time zone.
 *
 * Week rule: a weekly's number is the ISO 8601 week of its own `date`, whatever weekday it was
 * published on. ISO weeks run Monday to Sunday and week 1 holds the year's first Thursday, so every
 * day from Monday to Sunday of one week gives one number, and the printed range is that Monday to
 * Sunday. Around New Year the ISO year can differ from the calendar year; only the number is shown.
 * The theme still comes from the calendar month of `date`, so a weekly whose range crosses a month
 * takes the theme of the month it was published in.
 */

const DAY_MS = 86_400_000;

export const MONTH_NAMES = [
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

export interface YmdParts {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

export function parseYmd(date: string): YmdParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Cover date must be YYYY-MM-DD, got "${date}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Cover date is not a real day: "${date}"`);
  }
  return { year, month, day };
}

function utc(date: string): number {
  const { year, month, day } = parseYmd(date);
  return Date.UTC(year, month - 1, day);
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayIndex(date: string): number {
  return new Date(utc(date)).getUTCDay();
}

/** ISO 8601 week number, 1 to 53. */
export function isoWeek(date: string): number {
  const t = utc(date);
  const isoDay = weekdayIndex(date) || 7;
  const thursday = t + (4 - isoDay) * DAY_MS;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - yearStart) / DAY_MS / 7) + 1;
}

/** Monday and Sunday of the ISO week holding `date`. */
export function isoWeekRange(date: string): { monday: YmdParts; sunday: YmdParts } {
  const t = utc(date);
  const isoDay = weekdayIndex(date) || 7;
  const part = (ms: number): YmdParts => {
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  };
  return { monday: part(t - (isoDay - 1) * DAY_MS), sunday: part(t + (7 - isoDay) * DAY_MS) };
}

/** The weekly's range on one line: "13 – 19 October" or "28 Sep – 4 Oct", from that year's own calendar. */
export function rangeLabel(date: string): string {
  const { monday, sunday } = isoWeekRange(date);
  const name = (m: number) => MONTH_NAMES[m - 1] ?? "";
  if (monday.month === sunday.month) return `${monday.day} – ${sunday.day} ${name(monday.month)}`;
  const short = (m: number) => name(m).slice(0, 3);
  return `${monday.day} ${short(monday.month)} – ${sunday.day} ${short(sunday.month)}`;
}

/**
 * The year a cover prints after its month or range: the date's own year, or for a weekly whose week
 * crosses New Year both years, "2026–27".
 */
export function yearLabel(date: string, weekly: boolean): string {
  if (!weekly) return String(parseYmd(date).year);
  const { monday, sunday } = isoWeekRange(date);
  if (monday.year === sunday.year) return String(monday.year);
  return `${monday.year}–${String(sunday.year).slice(2)}`;
}
