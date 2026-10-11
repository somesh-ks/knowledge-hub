import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CustomDefaults,
  DEFAULT_SCHEDULE,
  LastRunFile,
  type PodcastFormat,
  ScheduleFile,
  STATE_FILES,
  type WeeklySchedule,
} from "@dispatch/core";
import { hourLabel, nextBriefing, nextWeekly, WEEKDAYS } from "./nextRun";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

export { hourLabel, nextBriefing, nextWeekly, WEEKDAYS } from "./nextRun";

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

export interface ScheduleView {
  timezone: string;
  hour: number;
  cadenceDays: number;
  /** Topic ids the daily briefing leaves out. */
  skipTopics: string[];
  format: PodcastFormat;
  lengthMinutes: number;
  /** Speechify voice ids of the daily podcast; null is the engine's default. */
  voiceId: string | null;
  voiceIdB: string | null;
  weekly: WeeklySchedule;
  custom: CustomDefaults;
  next: string;
  nextWeekly: string;
  /** The runs the next daily episode counts from, for the page to work the line out again. */
  lastRegularAt: string | null;
  lastWeeklyAt: string | null;
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
    timezone,
    hour,
    cadence_days: cadenceDays,
    skip_topics: skipTopics,
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
  const weeklyRun = lastRun.success ? lastRun.data.weekly : undefined;
  const lastRegularAt = counts ? regular.at : null;
  const lastWeeklyAt = weeklyRun?.outcome === "published" ? weeklyRun.at : null;
  return {
    timezone: timezone ?? "Europe/Stockholm",
    hour,
    cadenceDays,
    skipTopics,
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
      lastRegularAt,
      lastWeeklyAt,
      weeklyDay: weekly.enabled ? weekly.day : null,
    }),
    nextWeekly: nextWeekly({ now: options.now ?? new Date(), day: weekly.day, hour: weekly.hour }),
    lastRegularAt,
    lastWeeklyAt,
  };
}
