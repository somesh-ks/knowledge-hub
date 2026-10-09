import { z } from "zod";
import { SectionId } from "./categories.js";
import { PodcastFormat } from "./podcast.js";

/** Days between scheduled briefings the owner can pick: every day, second day, third day, weekly. */
export const SCHEDULE_CADENCES = [1, 2, 3, 7] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** Section a scheduled briefing always covers, listed or not. */
export const ALWAYS_COVERED_SECTION = "top";

/** Minutes a scheduled podcast runs: the same choices as a podcast made by hand. */
export const SCHEDULE_LENGTHS = [3, 5, 10, 15] as const;
export type ScheduleLength = (typeof SCHEDULE_LENGTHS)[number];
export const ScheduleLengthMinutes = z.union([
  z.literal(3),
  z.literal(5),
  z.literal(10),
  z.literal(15),
]);

const CadenceDays = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(7)]);

/** A Speechify voice id: the engine's own rule for a voice (see apps/web/src/server/config.ts). */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** A voice id, or null for the engine's default voice. */
export const VoiceId = z.string().regex(VOICE_ID_PATTERN).nullable();

/** Types a weekly or Create-panel podcast may be: the owner no longer picks Headlines. */
export const SCHEDULE_FORMATS = ["readout", "discussion"] as const;
const ScheduleFormat = z.enum(SCHEDULE_FORMATS);

/** The weekly podcast: its own day, hour, type, length and voices, apart from the daily one. */
const WeeklyFields = z.object({
  enabled: z.boolean(),
  /** Day of the week in Stockholm time, 0 = Sunday. */
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  format: ScheduleFormat,
  length_minutes: ScheduleLengthMinutes,
  voice_id: VoiceId,
  voice_id_b: VoiceId,
});
export type WeeklySchedule = z.infer<typeof WeeklyFields>;

/** What the Create panel starts from. */
const CustomFields = z.object({
  format: ScheduleFormat,
  length_minutes: ScheduleLengthMinutes,
  voice_id: VoiceId,
  voice_id_b: VoiceId,
});
export type CustomDefaults = z.infer<typeof CustomFields>;

/** The values a file without a `weekly` or `custom` key runs on (the weekly hour is the daily one). */
export const DEFAULT_WEEKLY: Omit<WeeklySchedule, "hour"> = {
  enabled: true,
  day: 0,
  format: "readout",
  length_minutes: 10,
  voice_id: null,
  voice_id_b: null,
};
export const DEFAULT_CUSTOM: CustomDefaults = {
  format: "readout",
  length_minutes: 5,
  voice_id: null,
  voice_id_b: null,
};

/**
 * Shape of config/schedule.json. `hour` is a whole hour of Stockholm time. `sections` is null for
 * every enabled topic, or the section ids a scheduled briefing covers; Top picks is always covered.
 * `format`, `length_minutes`, `voice_id` and `voice_id_b` shape the daily podcast; `weekly` the
 * weekly one; `custom` the defaults of the Create panel. A file written before any of these
 * existed parses with the defaults, and a partial `weekly` or `custom` is filled in.
 */
export const ScheduleFile = z
  .object({
    version: z.literal(1),
    hour: z.number().int().min(0).max(23),
    cadence_days: CadenceDays,
    sections: z.array(SectionId).min(1).max(60).nullable(),
    format: PodcastFormat.default("readout"),
    length_minutes: ScheduleLengthMinutes.default(10),
    voice_id: VoiceId.default(null),
    voice_id_b: VoiceId.default(null),
    weekly: WeeklyFields.partial().optional(),
    custom: CustomFields.partial().optional(),
  })
  .transform((file) => ({
    ...file,
    weekly: { ...DEFAULT_WEEKLY, hour: file.hour, ...stripUndefined(file.weekly) },
    custom: { ...DEFAULT_CUSTOM, ...stripUndefined(file.custom) },
  }));
export type ScheduleFile = z.output<typeof ScheduleFile>;

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/** What a repository without config/schedule.json runs on: the original cron, every second day. */
export const DEFAULT_SCHEDULE: ScheduleFile = {
  version: 1,
  hour: 7,
  cadence_days: 2,
  sections: null,
  format: "readout",
  length_minutes: 10,
  voice_id: null,
  voice_id_b: null,
  weekly: { ...DEFAULT_WEEKLY, hour: 7 },
  custom: { ...DEFAULT_CUSTOM },
};

/** The complete settings of the schedule file, without its version. */
export const ScheduleSettings = z.object({
  hour: z.number().int().min(0).max(23),
  cadence_days: CadenceDays,
  sections: z.array(SectionId).min(1).max(60).nullable(),
  format: PodcastFormat,
  length_minutes: ScheduleLengthMinutes,
  voice_id: VoiceId,
  voice_id_b: VoiceId,
  weekly: WeeklyFields,
  custom: CustomFields,
});
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;

/** What `schedule.set` may carry: any subset of the settings, `weekly` and `custom` field by field. */
export const ScheduleChange = z.object({
  hour: ScheduleSettings.shape.hour.optional(),
  cadence_days: CadenceDays.optional(),
  sections: ScheduleSettings.shape.sections.optional(),
  format: PodcastFormat.optional(),
  length_minutes: ScheduleLengthMinutes.optional(),
  voice_id: VoiceId.optional(),
  voice_id_b: VoiceId.optional(),
  weekly: WeeklyFields.partial().optional(),
  custom: CustomFields.partial().optional(),
});
export type ScheduleChange = z.infer<typeof ScheduleChange>;

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
