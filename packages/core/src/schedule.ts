import { z } from "zod";
import { IdString } from "./categories.js";
import { PodcastFormat, VoiceId } from "./podcast.js";

/** Days between scheduled briefings the owner can pick: every day, second day, third day, weekly. */
export const SCHEDULE_CADENCES = [1, 2, 3, 7] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

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

/** Types a weekly or Create-panel podcast may be: the owner no longer picks Headlines. */
export const SCHEDULE_FORMATS = ["readout", "discussion"] as const;
const ScheduleFormat = z.enum(SCHEDULE_FORMATS);

/**
 * Topic ids a scheduled episode leaves out. Empty covers every topic that is on, so a topic added
 * later is in every episode until it is left out of one.
 */
const SkipTopics = z.array(IdString).max(200);

/** The weekly podcast: its own day, hour, topics, type, length and voices, apart from the daily one. */
const WeeklyFields = z.object({
  enabled: z.boolean(),
  /** Day of the week in Stockholm time, 0 = Sunday. */
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  skip_topics: SkipTopics,
  format: ScheduleFormat,
  length_minutes: ScheduleLengthMinutes,
  voice_id: VoiceId,
  voice_id_b: VoiceId,
});
export type WeeklySchedule = z.infer<typeof WeeklyFields>;

/**
 * What the Create panel starts from. `skip_topics` lists the topics out of the Custom scope (D69):
 * the panel does not offer them.
 */
const CustomFields = z.object({
  skip_topics: SkipTopics,
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
  skip_topics: [],
  format: "readout",
  length_minutes: 10,
  voice_id: null,
  voice_id_b: null,
};
export const DEFAULT_CUSTOM: CustomDefaults = {
  skip_topics: [],
  format: "readout",
  length_minutes: 5,
  voice_id: null,
  voice_id_b: null,
};

/**
 * Shape of config/schedule.json. `hour` is a whole hour of Stockholm time. `skip_topics` lists the
 * topics the daily briefing leaves out (the weekly one has its own); empty covers them all. A file
 * from before topics could be left out (it had `sections`, always null in use) reads as empty.
 * `format`, `length_minutes`, `voice_id` and `voice_id_b` shape the daily podcast; `weekly` the
 * weekly one; `custom` the defaults of the Create panel. A file written before any of these
 * existed parses with the defaults, and a partial `weekly` or `custom` is filled in.
 */
export const ScheduleFile = z
  .object({
    version: z.literal(1),
    timezone: z.string().min(1).max(100).default("Europe/Stockholm"),
    hour: z.number().int().min(0).max(23),
    cadence_days: CadenceDays,
    skip_topics: SkipTopics.default([]),
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
  timezone: "Europe/Stockholm",
  hour: 7,
  cadence_days: 2,
  skip_topics: [],
  format: "readout",
  length_minutes: 10,
  voice_id: null,
  voice_id_b: null,
  weekly: { ...DEFAULT_WEEKLY, hour: 7 },
  custom: { ...DEFAULT_CUSTOM },
};

/** The complete settings of the schedule file, without its version. */
export const ScheduleSettings = z.object({
  timezone: z.string().min(1).max(100),
  hour: z.number().int().min(0).max(23),
  cadence_days: CadenceDays,
  skip_topics: SkipTopics,
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
  timezone: ScheduleSettings.shape.timezone.optional(),
  hour: ScheduleSettings.shape.hour.optional(),
  cadence_days: CadenceDays.optional(),
  skip_topics: ScheduleSettings.shape.skip_topics.optional(),
  format: PodcastFormat.optional(),
  length_minutes: ScheduleLengthMinutes.optional(),
  voice_id: VoiceId.optional(),
  voice_id_b: VoiceId.optional(),
  weekly: WeeklyFields.partial().optional(),
  custom: CustomFields.partial().optional(),
});
export type ScheduleChange = z.infer<typeof ScheduleChange>;
