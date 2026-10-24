import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CustomDefaults,
  DEFAULT_SCHEDULE,
  effectiveSkipTopics,
  podcastVoices,
  ScheduleFile,
  scheduleZone,
  type WeeklySchedule,
} from "@singularity/core";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

export { hourLabel, WEEKDAYS } from "./nextRun";
export { CADENCES, dailySummary, weeklySummary } from "./settingsSummary";

/**
 * What the Schedule page shows, read from the repository at build time. A missing or invalid
 * config/schedule.json means the defaults, which is what the engine runs on too.
 */

export interface ScheduleView {
  /** The schedule's clock: its stored zone, or Stockholm when that is not one of the list. */
  timezone: string;
  hour: number;
  cadenceDays: number;
  /** Topic ids the daily briefing leaves out. */
  skipTopics: string[];
  lengthMinutes: number;
  /** Speechify voice ids of every podcast (the Podcast voice page); null is the engine's default. */
  voiceId: string | null;
  voiceIdB: string | null;
  weekly: WeeklySchedule;
  /** The Create panel's defaults, its voices the shared pair (podcastVoices). */
  custom: CustomDefaults;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function loadScheduleView(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<ScheduleView> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  return scheduleViewOf(await readJson(join(base, "config", "schedule.json")));
}

/** The view of a schedule file as parsed JSON, or of the defaults when it is not a valid one. */
export function scheduleViewOf(scheduleFile: unknown): ScheduleView {
  const schedule = ScheduleFile.safeParse(scheduleFile);
  const file = schedule.success ? schedule.data : DEFAULT_SCHEDULE;
  const {
    timezone: storedZone,
    hour,
    cadence_days: cadenceDays,
    length_minutes: lengthMinutes,
    voice_id: voiceId,
    voice_id_b: voiceIdB,
    custom,
  } = file;
  // The lists the engine reads: until an edit says where the general news topics play, they count as
  // left out of the daily and weekly podcasts, and the chips show them so.
  const skipTopics = effectiveSkipTopics(file, "daily");
  const weekly = { ...file.weekly, skip_topics: effectiveSkipTopics(file, "weekly") };
  const timezone = scheduleZone(storedZone);
  return {
    timezone,
    hour,
    cadenceDays,
    skipTopics,
    lengthMinutes,
    voiceId,
    voiceIdB,
    weekly,
    custom: { ...custom, ...podcastVoices(file, "custom") },
  };
}
