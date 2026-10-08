import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_SCHEDULE,
  daysBetween,
  LastRunFile,
  ScheduleFile,
  STATE_FILES,
  stockholmDate,
  TIME_ZONE,
} from "@dispatch/core";
import { type ManageTopic, parseTopicsFile } from "./manage";
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

/** One line of the checklist: a section the briefing can cover, with the topics that feed it. */
export interface CoverOption {
  id: string;
  title: string;
  topics: string[];
}

/**
 * The sections a scheduled briefing can cover: those with at least one topic that is on and may
 * publish, in page order, without Top picks (always covered). A custom topic has a section of its
 * own and so reads as the topic; a built-in section reads as its title with its topics under it.
 */
export function coverOptions(
  topics: readonly ManageTopic[],
  sections: readonly { id: string; title: string; order: number }[],
): CoverOption[] {
  const live = topics.filter((topic) => topic.enabled && !topic.never_publish);
  return sections
    .filter((section) => section.id !== "top")
    .flatMap((section) => {
      const names = live.filter((topic) => topic.section_id === section.id).map((t) => t.name);
      return names.length > 0 ? [{ id: section.id, title: section.title, topics: names }] : [];
    });
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

export interface ScheduleView {
  hour: number;
  cadenceDays: number;
  /** Section ids covered, or null for every one. */
  sections: string[] | null;
  options: CoverOption[];
  next: string;
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
  const [scheduleFile, topicsFile, lastRunFile] = await Promise.all([
    readJson(join(base, "config", "schedule.json")),
    readJson(join(base, "config", "topics.json")),
    readJson(join(base, STATE_FILES.lastRun)),
  ]);
  const schedule = ScheduleFile.safeParse(scheduleFile);
  const {
    hour,
    cadence_days: cadenceDays,
    sections,
  } = schedule.success ? schedule.data : DEFAULT_SCHEDULE;
  const parsed = parseTopicsFile(topicsFile);
  const covers = parsed ? coverOptions(parsed.topics, parsed.sections) : [];
  const lastRun = LastRunFile.safeParse(lastRunFile);
  const regular = lastRun.success ? lastRun.data.regular : undefined;
  const counts = regular && (regular.outcome === "published" || regular.outcome === "nothing");
  return {
    hour,
    cadenceDays,
    sections,
    options: covers,
    next: nextBriefing({
      now: options.now ?? new Date(),
      hour,
      cadenceDays,
      lastRegularAt: counts ? regular.at : null,
    }),
  };
}
