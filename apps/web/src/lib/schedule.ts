import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CustomDefaults,
  DEFAULT_SCHEDULE,
  daysBetween,
  LastRunFile,
  type PodcastFormat,
  ScheduleFile,
  STATE_FILES,
  stockholmDate,
  TIME_ZONE,
  type WeeklySchedule,
} from "@dispatch/core";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * What the Schedule page shows, read from the repository at build time. A missing or invalid
 * config/schedule.json means the defaults, which is what the engine runs on too.
 */

export const CADENCES = [
  { days: 1, label: "Every day" },
  { days: 2, label: "Every second day" },
  { days: 3, label: "Every third day" },
  { days: 7, label: "Once a week" },
] as const;

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

/**
 * What each row of the Settings index says about the page behind it, in a few words worked out when
 * the site is built: "Every second day at 07:00", and "Sundays at 07:00" or "Off".
 */
export function dailySummary(input: { hour: number; cadenceDays: number }): string {
  const cadence =
    CADENCES.find((entry) => entry.days === input.cadenceDays)?.label ??
    `Every ${input.cadenceDays} days`;
  return `${cadence} at ${hourLabel(input.hour)}`;
}

export function weeklySummary(input: { enabled: boolean; day: number; hour: number }): string {
  const day = WEEKDAYS[input.day];
  if (!input.enabled || !day) return "Off";
  return `${day}s at ${hourLabel(input.hour)}`;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function stockholmHour(at: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return Number(hour);
}

/**
 * "Next briefing: about Friday at 07:00", worked out when the site is built from the last regular
 * run, the cadence and the hour. It is a guess made at build time, so it says "about".
 */
export function nextBriefing(input: {
  now: Date;
  hour: number;
  cadenceDays: number;
  lastRegularAt: string | null;
}): string {
  const today = stockholmDate(input.now);
  let date = today;
  if (input.lastRegularAt) {
    const last = new Date(input.lastRegularAt);
    if (!Number.isNaN(last.getTime())) date = addDays(stockholmDate(last), input.cadenceDays);
  }
  if (daysBetween(today, date) < 0) date = today;
  if (date === today && stockholmHour(input.now) >= input.hour) date = addDays(today, 1);
  const day =
    date === today
      ? "today"
      : date === addDays(today, 1)
        ? "tomorrow"
        : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(
            new Date(`${date}T12:00:00Z`),
          );
  return `Next briefing: about ${day} at ${hourLabel(input.hour)}`;
}

/**
 * "Next weekly: about Sunday at 07:00", worked out at build time from the day and the hour.
 */
export function nextWeekly(input: { now: Date; day: number; hour: number }): string {
  const today = stockholmDate(input.now);
  const todayDay = new Date(`${today}T12:00:00Z`).getUTCDay();
  let ahead = (input.day - todayDay + 7) % 7;
  if (ahead === 0 && stockholmHour(input.now) >= input.hour) ahead = 7;
  const day = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : (WEEKDAYS[input.day] ?? "");
  return `Next weekly: about ${day} at ${hourLabel(input.hour)}`;
}

export interface ScheduleView {
  hour: number;
  cadenceDays: number;
  /** Section ids covered, or null for every one. The Daily podcast page sends them back as saved. */
  sections: string[] | null;
  format: PodcastFormat;
  lengthMinutes: number;
  /** Speechify voice ids of the daily podcast; null is the engine's default. */
  voiceId: string | null;
  voiceIdB: string | null;
  weekly: WeeklySchedule;
  custom: CustomDefaults;
  next: string;
  nextWeekly: string;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function loadScheduleView(
  options: { root?: string; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<ScheduleView> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  const [scheduleFile, lastRunFile] = await Promise.all([
    readJson(join(base, "config", "schedule.json")),
    readJson(join(base, STATE_FILES.lastRun)),
  ]);
  const schedule = ScheduleFile.safeParse(scheduleFile);
  const {
    hour,
    cadence_days: cadenceDays,
    sections,
    format,
    length_minutes: lengthMinutes,
    voice_id: voiceId,
    voice_id_b: voiceIdB,
    weekly,
    custom,
  } = schedule.success ? schedule.data : DEFAULT_SCHEDULE;
  const lastRun = LastRunFile.safeParse(lastRunFile);
  const regular = lastRun.success ? lastRun.data.regular : undefined;
  const counts = regular && (regular.outcome === "published" || regular.outcome === "nothing");
  return {
    hour,
    cadenceDays,
    sections,
    format,
    lengthMinutes,
    voiceId,
    voiceIdB,
    weekly,
    custom,
    next: nextBriefing({
      now: options.now ?? new Date(),
      hour,
      cadenceDays,
      lastRegularAt: counts ? regular.at : null,
    }),
    nextWeekly: nextWeekly({ now: options.now ?? new Date(), day: weekly.day, hour: weekly.hour }),
  };
}
