export const TIME_ZONE = "Europe/Stockholm";

export interface TimezoneOption {
  /** IANA zone name, as stored in config/schedule.json. */
  value: string;
  /** A plain place name: an abbreviation such as CET is wrong for half the year. */
  label: string;
}

/**
 * The zones the schedule can count in (D71, D101), west to east by their standard time. Every
 * offset is a whole hour except India's: a half-hour zone starts a run up to 30 minutes early (see
 * state.md), so no new one is added.
 */
export const SUPPORTED_TIMEZONES: readonly TimezoneOption[] = [
  { value: "Pacific/Honolulu", label: "Honolulu" },
  { value: "America/Anchorage", label: "Anchorage" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Phoenix", label: "Phoenix" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Bogota", label: "Bogotá" },
  { value: "America/Lima", label: "Lima" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { value: "Atlantic/Reykjavik", label: "Reykjavik" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Lisbon", label: "Lisbon" },
  { value: "Europe/Amsterdam", label: "Amsterdam" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "Europe/Vienna", label: "Vienna" },
  { value: "Europe/Warsaw", label: "Warsaw" },
  { value: "Europe/Zurich", label: "Zurich" },
  { value: "Africa/Lagos", label: "Lagos" },
  { value: "Europe/Athens", label: "Athens" },
  { value: "Europe/Helsinki", label: "Helsinki" },
  { value: "Europe/Kyiv", label: "Kyiv" },
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Africa/Johannesburg", label: "Johannesburg" },
  { value: "Asia/Jerusalem", label: "Jerusalem" },
  { value: "Europe/Istanbul", label: "Istanbul" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "Asia/Riyadh", label: "Riyadh" },
  { value: "Africa/Nairobi", label: "Nairobi" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Dhaka", label: "Dhaka" },
  { value: "Asia/Bangkok", label: "Bangkok" },
  { value: "Asia/Jakarta", label: "Jakarta" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Manila", label: "Manila" },
  { value: "Australia/Perth", label: "Perth" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Australia/Brisbane", label: "Brisbane" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
];

export function isSupportedTimeZone(zone: string): boolean {
  return SUPPORTED_TIMEZONES.some((option) => option.value === zone);
}

/**
 * How far a zone is from Greenwich at an instant, daylight saving included: "GMT+2", "GMT-5",
 * "GMT+5:30". Greenwich itself is "GMT+0". A zone Intl does not know reads "GMT+0" rather than
 * throwing: the label is only a hint beside the zone's name.
 */
export function gmtOffset(zone: string, at: Date = new Date()): string {
  let text = "GMT";
  try {
    text =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    // An unknown zone name: the label stays at Greenwich.
  }
  const match = /^GMT(?:([+\u2212-])(\d{1,2})(?::(\d{2}))?)?$/.exec(text);
  if (!match || match[1] === undefined) return "GMT+0";
  const sign = match[1] === "+" ? "+" : "-";
  const minutes = match[3] && match[3] !== "00" ? `:${match[3]}` : "";
  return `GMT${sign}${Number(match[2])}${minutes}`;
}

/** The text a zone is picked by: its place name and its offset, "Stockholm (GMT+2)". */
export function zoneLabel(option: TimezoneOption, at: Date = new Date()): string {
  return `${option.label} (${gmtOffset(option.value, at)})`;
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
