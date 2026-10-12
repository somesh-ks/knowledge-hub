export const TIME_ZONE = "Europe/Stockholm";

export interface TimezoneOption {
  /** IANA zone name, as stored in config/schedule.json. */
  value: string;
  /** A plain place name: an abbreviation such as CET is wrong for half the year. */
  label: string;
}

/** The zones the schedule can count in (D71). */
export const SUPPORTED_TIMEZONES: readonly TimezoneOption[] = [
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" },
];

export function isSupportedTimeZone(zone: string): boolean {
  return SUPPORTED_TIMEZONES.some((option) => option.value === zone);
}

/**
 * The zone a schedule counts in: its stored zone when it is one of the list, otherwise Stockholm,
 * so a hand-edited file with a name Intl does not know never stops a run.
 */
export function scheduleZone(zone: string | undefined): string {
  return zone !== undefined && isSupportedTimeZone(zone) ? zone : TIME_ZONE;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const hourFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(zone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormats.set(zone, format);
  }
  return format;
}

function hourFormat(zone: string): Intl.DateTimeFormat {
  let format = hourFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      hourCycle: "h23",
    });
    hourFormats.set(zone, format);
  }
  return format;
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function zonedDate(at: Date, zone: string = TIME_ZONE): string {
  return dateFormat(zone).format(at);
}

/** Whole hour of an instant in a time zone, 0 to 23 (07:30 in India is hour 7). */
export function zonedHour(at: Date, zone: string = TIME_ZONE): number {
  return Number(hourFormat(zone).format(at));
}

/** Stockholm calendar date (YYYY-MM-DD) of an instant. */
export function stockholmDate(at: Date): string {
  return zonedDate(at, TIME_ZONE);
}

/** Whole hour of an instant in Stockholm time, 0 to 23. */
export function stockholmHour(at: Date): number {
  return zonedHour(at, TIME_ZONE);
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
