/**
 * When the next scheduled episode is due, in words: "Next episode: about Friday at 07:00". It has no
 * imports and touches no DOM, so the build writes the line into the page and the browser rewrites it
 * from the fields on screen with the real current time (podcastPage.ts). The engine's gate counts in
 * Stockholm time, and so does this.
 */

const ZONE = "Europe/Stockholm";

/** "07:00" for hour 7. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** YYYY-MM-DD of an instant in Stockholm. */
function zoneDate(at: Date): string {
  return dateFormat.format(at);
}

function zoneHour(at: Date): number {
  return Number(hourFormat.format(at));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function readableDate(at: string | null | undefined): string | null {
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : zoneDate(date);
}

function line(day: string, hour: number): string {
  return `Next episode: about ${day} at ${hourLabel(hour)}`;
}

/**
 * The next daily episode, as the engine's gate decides: the cadence counts from the later of the
 * last regular run and the last weekly episode, and the weekly episode's day has no daily one. It is
 * a guess, so it says "about".
 */
export function nextBriefing(input: {
  now: Date;
  hour: number;
  cadenceDays: number;
  lastRegularAt: string | null;
  /** When the last weekly episode was published. */
  lastWeeklyAt?: string | null;
  /** The weekly episode's day (0 = Sunday), or null while it is off. */
  weeklyDay?: number | null;
}): string {
  const today = zoneDate(input.now);
  const anchors = [readableDate(input.lastRegularAt), readableDate(input.lastWeeklyAt)].filter(
    (date): date is string => date !== null,
  );
  const last = anchors.sort().at(-1);
  let date = last ? addDays(last, input.cadenceDays) : today;
  if (daysBetween(today, date) < 0) date = today;
  if (date === today && zoneHour(input.now) >= input.hour) date = addDays(today, 1);
  if (input.weeklyDay != null && weekday(date) === input.weeklyDay) date = addDays(date, 1);
  const day =
    date === today
      ? "today"
      : date === addDays(today, 1)
        ? "tomorrow"
        : (WEEKDAYS[weekday(date)] ?? "");
  return line(day, input.hour);
}

/** The next weekly episode, from its day and hour. */
export function nextWeekly(input: { now: Date; day: number; hour: number }): string {
  const today = zoneDate(input.now);
  let ahead = (input.day - weekday(today) + 7) % 7;
  if (ahead === 0 && zoneHour(input.now) >= input.hour) ahead = 7;
  const day = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : (WEEKDAYS[input.day] ?? "");
  return line(day, input.hour);
}

/** What the head of a profile page carries for the browser to work the line out again. */
export interface RunAnchors {
  lastRegularAt: string | null;
  lastWeeklyAt: string | null;
}

/**
 * The line for a profile page from the values its fields hold (`daily.hour`, `daily.cadence`,
 * `weekly.day`, `weekly.hour`, `weekly.enabled`), or null when they do not add up to one.
 * `weeklyDay` is the weekly episode's day while it is on, for the daily page.
 */
export function nextRunLine(
  profile: "daily" | "weekly",
  fields: Readonly<Record<string, string | undefined>>,
  anchors: RunAnchors & { weeklyDay: number | null },
  now: Date,
): string | null {
  const number = (key: string): number | null => {
    const value = fields[key];
    if (value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  };
  const hour = number(`${profile}.hour`);
  if (hour === null) return null;
  if (profile === "weekly") {
    const day = number("weekly.day");
    return day === null ? null : nextWeekly({ now, day, hour });
  }
  const cadenceDays = number("daily.cadence");
  if (cadenceDays === null) return null;
  return nextBriefing({
    now,
    hour,
    cadenceDays,
    lastRegularAt: anchors.lastRegularAt,
    lastWeeklyAt: anchors.lastWeeklyAt,
    weeklyDay: anchors.weeklyDay,
  });
}
