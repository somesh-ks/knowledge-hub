export const TIME_ZONE = "Europe/Stockholm";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** Stockholm calendar date (YYYY-MM-DD) of an instant. */
export function stockholmDate(at: Date): string {
  return dateFormat.format(at);
}

/** Whole hour of an instant in Stockholm time, 0 to 23. */
export function stockholmHour(at: Date): number {
  return Number(hourFormat.format(at));
}

/** Whole calendar days from `a` to `b` (both YYYY-MM-DD), positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Day of week for a YYYY-MM-DD date, 0 = Sunday. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** English long date such as "Wednesday 7 October". */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(",", "");
}
