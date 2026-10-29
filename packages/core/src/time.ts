export const TIME_ZONE = "Europe/Stockholm";

export interface TimezoneOption {
  /** IANA zone name, as stored in config/schedule.json. */
  value: string;
  /** A plain place name: an abbreviation such as CET is wrong for half the year. */
  label: string;
  /** ISO 3166 country code, for a flag beside the place; none for UTC. */
  country?: string;
}

/** A country's flag as its two regional indicator letters; some systems draw the letters instead. */
export function flagOf(country: string): string {
  return String.fromCodePoint(...[...country].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

/**
 * The zones the schedule can count in (D71, D101), west to east by their standard time. Every
 * offset is a whole hour except India's: a half-hour zone starts a run up to 30 minutes early (see
 * state.md), so no new one is added.
 */
export const SUPPORTED_TIMEZONES: readonly TimezoneOption[] = [
  { value: "Pacific/Honolulu", label: "Honolulu", country: "US" },
  { value: "America/Anchorage", label: "Anchorage", country: "US" },
  { value: "America/Los_Angeles", label: "Los Angeles", country: "US" },
  { value: "America/Vancouver", label: "Vancouver", country: "CA" },
  { value: "America/Denver", label: "Denver", country: "US" },
  { value: "America/Phoenix", label: "Phoenix", country: "US" },
  { value: "America/Chicago", label: "Chicago", country: "US" },
  { value: "America/Mexico_City", label: "Mexico City", country: "MX" },
  { value: "America/New_York", label: "New York", country: "US" },
  { value: "America/Toronto", label: "Toronto", country: "CA" },
  { value: "America/Bogota", label: "Bogotá", country: "CO" },
  { value: "America/Lima", label: "Lima", country: "PE" },
  { value: "America/Sao_Paulo", label: "São Paulo", country: "BR" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires", country: "AR" },
  { value: "Atlantic/Reykjavik", label: "Reykjavik", country: "IS" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London", country: "GB" },
  { value: "Europe/Dublin", label: "Dublin", country: "IE" },
  { value: "Europe/Lisbon", label: "Lisbon", country: "PT" },
  { value: "Europe/Amsterdam", label: "Amsterdam", country: "NL" },
  { value: "Europe/Berlin", label: "Berlin", country: "DE" },
  { value: "Europe/Madrid", label: "Madrid", country: "ES" },
  { value: "Europe/Paris", label: "Paris", country: "FR" },
  { value: "Europe/Rome", label: "Rome", country: "IT" },
  { value: "Europe/Stockholm", label: "Stockholm", country: "SE" },
  { value: "Europe/Vienna", label: "Vienna", country: "AT" },
  { value: "Europe/Warsaw", label: "Warsaw", country: "PL" },
  { value: "Europe/Zurich", label: "Zurich", country: "CH" },
  { value: "Africa/Lagos", label: "Lagos", country: "NG" },
  { value: "Europe/Athens", label: "Athens", country: "GR" },
  { value: "Europe/Helsinki", label: "Helsinki", country: "FI" },
  { value: "Europe/Kyiv", label: "Kyiv", country: "UA" },
  { value: "Africa/Cairo", label: "Cairo", country: "EG" },
  { value: "Africa/Johannesburg", label: "Johannesburg", country: "ZA" },
  { value: "Asia/Jerusalem", label: "Jerusalem", country: "IL" },
  { value: "Europe/Istanbul", label: "Istanbul", country: "TR" },
  { value: "Europe/Moscow", label: "Moscow", country: "RU" },
  { value: "Asia/Riyadh", label: "Riyadh", country: "SA" },
  { value: "Africa/Nairobi", label: "Nairobi", country: "KE" },
  { value: "Asia/Dubai", label: "Dubai", country: "AE" },
  { value: "Asia/Karachi", label: "Karachi", country: "PK" },
  { value: "Asia/Kolkata", label: "India", country: "IN" },
  { value: "Asia/Dhaka", label: "Dhaka", country: "BD" },
  { value: "Asia/Bangkok", label: "Bangkok", country: "TH" },
  { value: "Asia/Jakarta", label: "Jakarta", country: "ID" },
  { value: "Asia/Singapore", label: "Singapore", country: "SG" },
  { value: "Asia/Hong_Kong", label: "Hong Kong", country: "HK" },
  { value: "Asia/Shanghai", label: "Shanghai", country: "CN" },
  { value: "Asia/Manila", label: "Manila", country: "PH" },
  { value: "Australia/Perth", label: "Perth", country: "AU" },
  { value: "Asia/Tokyo", label: "Tokyo", country: "JP" },
  { value: "Asia/Seoul", label: "Seoul", country: "KR" },
  { value: "Australia/Brisbane", label: "Brisbane", country: "AU" },
  { value: "Australia/Sydney", label: "Sydney", country: "AU" },
  { value: "Pacific/Auckland", label: "Auckland", country: "NZ" },
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

/** A zone's offset from Greenwich in minutes at an instant, or null for a name Intl does not know. */
function offsetMinutes(zone: string, at: Date): number | null {
  try {
    const text =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /^GMT(?:([+\u2212-])(\d{1,2})(?::(\d{2}))?)?$/.exec(text);
    if (!match) return null;
    if (match[1] === undefined) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === "+" ? minutes : -minutes;
  } catch {
    return null;
  }
}

const signatures = new Map<string, string | null>();

/**
 * How a zone's clock runs over the next year: its offset on the same day of twelve months, so two
 * zones that keep the same time, daylight saving included, have the same signature (Oslo and
 * Stockholm do, Phoenix and Denver do not). Null for a name Intl does not know.
 */
function clockSignature(zone: string, at: Date): string | null {
  const key = `${zone}@${at.toISOString().slice(0, 10)}`;
  const kept = signatures.get(key);
  if (kept !== undefined) return kept;
  const offsets: number[] = [];
  for (let month = 0; month < 12; month++) {
    const offset = offsetMinutes(zone, new Date(at.getTime() + month * 30.4375 * 86_400_000));
    if (offset === null) {
      signatures.set(key, null);
      return null;
    }
    offsets.push(offset);
  }
  const signature = offsets.join(",");
  signatures.set(key, signature);
  return signature;
}

/** The zone the schedule could move to, from the one a device reports. */
export interface ZoneSuggestion {
  zone: string;
  /** The place name the list uses for it. */
  label: string;
  /** False when the device's own zone is not on the list and this one only keeps the same time. */
  exact: boolean;
  /** The flag of an exact zone's country: a stand-in zone says nothing of where the device is. */
  flag?: string;
}

/**
 * The zone to offer a device whose system zone is `device` while the schedule counts in `saved`
 * (D239), or null when there is nothing to offer: the same clock (a zone the list lacks, such as
 * Oslo, keeps Stockholm's time and asks for nothing), or a zone no entry of the list can stand for
 * (Kathmandu). A device zone on the list is offered as itself; one that is not, as the first entry
 * that keeps its time, and `exact` says which.
 */
export function suggestZone(
  device: string | undefined,
  saved: string,
  at: Date = new Date(),
): ZoneSuggestion | null {
  if (!device || device === saved) return null;
  const mine = clockSignature(device, at);
  if (mine === null || mine === clockSignature(saved, at)) return null;
  const listed = SUPPORTED_TIMEZONES.find((option) => option.value === device);
  const match =
    listed ?? SUPPORTED_TIMEZONES.find((option) => clockSignature(option.value, at) === mine);
  if (!match) return null;
  const flag = listed?.country ? flagOf(listed.country) : undefined;
  return {
    zone: match.value,
    label: match.label,
    exact: listed !== undefined,
    ...(flag ? { flag } : {}),
  };
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
