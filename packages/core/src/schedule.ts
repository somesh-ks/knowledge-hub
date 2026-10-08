import { z } from "zod";
import { SectionId } from "./categories.js";

/** Days between scheduled briefings the owner can pick: every day, second day, third day, weekly. */
export const SCHEDULE_CADENCES = [1, 2, 3, 7] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** Section a scheduled briefing always covers, listed or not. */
export const ALWAYS_COVERED_SECTION = "top";

const CadenceDays = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(7)]);

/**
 * Shape of config/schedule.json. `hour` is a whole hour of Stockholm time. `sections` is null for
 * every enabled topic, or the section ids a scheduled briefing covers; Top picks is always covered.
 */
export const ScheduleFile = z.object({
  version: z.literal(1),
  hour: z.number().int().min(0).max(23),
  cadence_days: CadenceDays,
  sections: z.array(SectionId).min(1).max(60).nullable(),
});
export type ScheduleFile = z.infer<typeof ScheduleFile>;

/** What a repository without config/schedule.json runs on: the original cron, every second day. */
export const DEFAULT_SCHEDULE: ScheduleFile = {
  version: 1,
  hour: 7,
  cadence_days: 2,
  sections: null,
};

/** The values `schedule.set` and the settings page send; the version is the file's own. */
export const ScheduleSettings = ScheduleFile.omit({ version: true });
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;

/** Whether a scheduled briefing covers a section. `sections: null` covers all of them. */
export function scheduleCovers(
  schedule: { sections: readonly string[] | null },
  section: string,
): boolean {
  return (
    schedule.sections === null ||
    section === ALWAYS_COVERED_SECTION ||
    schedule.sections.includes(section)
  );
}

/** The cron expression the schedule's hour stands for, as the run workflow compares it. */
export function scheduleCron(hour: number): string {
  return `13 ${hour} * * *`;
}
