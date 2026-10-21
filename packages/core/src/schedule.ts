import { z } from "zod";
import { IdString } from "./categories.js";
import { GENERAL_TOPICS } from "./generalTopics.js";
import { VoiceId } from "./podcast.js";
import { isSupportedTimeZone } from "./time.js";

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
  /** Day of the week in the schedule's time zone, 0 = Sunday. */
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
 * Shape of config/schedule.json. `hour` is a whole hour in `timezone`. `skip_topics` lists the
 * topics the daily briefing leaves out (the weekly one has its own); empty covers them all. A file
 * from before topics could be left out (it had `sections`, always null in use) reads as empty.
 * `length_minutes`, `voice_id` and `voice_id_b` shape the daily podcast; `weekly` the
 * weekly one; `custom` the defaults of the Create panel. A file written before any of these
 * existed parses with the defaults, and a partial `weekly` or `custom` is filled in. A top-level
 * `format` from an older file is read past and dropped: the daily podcast has no type to set (narration
 * reads the digest in one voice).
 */
export const ScheduleFile = z
  .object({
    version: z.literal(1),
    timezone: z.string().min(1).max(100).default("Europe/Stockholm"),
    hour: z.number().int().min(0).max(23),
    cadence_days: CadenceDays,
    skip_topics: SkipTopics.default([]),
    length_minutes: ScheduleLengthMinutes.default(10),
    voice_id: VoiceId.default(null),
    voice_id_b: VoiceId.default(null),
    weekly: WeeklyFields.partial().optional(),
    custom: CustomFields.partial().optional(),
    /**
     * True once the skip lists say where the general news topics play. A file without it
     * was written when they played in no scheduled podcast, so it reads as skipping them in the
     * daily and weekly ones (`effectiveSkipTopics`), and its lists are only rewritten with them
     * once an edit sets this (`withGeneralScope`).
     */
    general_scoped: z.boolean().optional(),
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
  length_minutes: 10,
  voice_id: null,
  voice_id_b: null,
  weekly: { ...DEFAULT_WEEKLY, hour: 7 },
  custom: { ...DEFAULT_CUSTOM },
};

/**
 * The topics the daily or the weekly podcast leaves out. The general news topics count as left
 * out until `general_scoped` says the lists have been written with them, so a file from before
 * they could play in a scheduled podcast keeps publishing what it did.
 */
export function effectiveSkipTopics(
  schedule: Pick<ScheduleFile, "skip_topics" | "weekly" | "general_scoped">,
  scope: "daily" | "weekly",
): string[] {
  const list = scope === "daily" ? schedule.skip_topics : schedule.weekly.skip_topics;
  if (schedule.general_scoped === true) return [...list];
  return [...new Set([...list, ...GENERAL_TOPICS.map((topic) => topic.id)])];
}

/**
 * The schedule with the general topics written into the daily and weekly skip lists and
 * `general_scoped` set: what an edit stores, so the lists mean what they say from then on.
 */
export function withGeneralScope(schedule: ScheduleFile): ScheduleFile {
  if (schedule.general_scoped === true) return schedule;
  return {
    ...schedule,
    skip_topics: effectiveSkipTopics(schedule, "daily"),
    weekly: { ...schedule.weekly, skip_topics: effectiveSkipTopics(schedule, "weekly") },
    general_scoped: true,
  };
}

/** Which podcast a voice is wanted for: the daily or weekly one, or one made in the Create panel. */
export type PodcastProfile = "daily" | "weekly" | "custom";

/**
 * The two voices a podcast is read in. The top-level pair is set once, on the Podcast voice page,
 * for every podcast. A weekly or Create voice saved before the pair was shared stands in only while
 * the shared one is unset (the site and the engine both ask this, so stored audio keeps its name).
 */
export function podcastVoices(
  schedule: Pick<ScheduleFile, "voice_id" | "voice_id_b" | "weekly" | "custom">,
  profile: PodcastProfile,
): { voice_id: string | null; voice_id_b: string | null } {
  const own =
    profile === "weekly" ? schedule.weekly : profile === "custom" ? schedule.custom : schedule;
  return {
    voice_id: schedule.voice_id ?? own.voice_id,
    voice_id_b: schedule.voice_id_b ?? own.voice_id_b,
  };
}

/** The complete settings of the schedule file, without its version. */
export const ScheduleSettings = z.object({
  timezone: z.string().min(1).max(100),
  hour: z.number().int().min(0).max(23),
  cadence_days: CadenceDays,
  skip_topics: SkipTopics,
  length_minutes: ScheduleLengthMinutes,
  voice_id: VoiceId,
  voice_id_b: VoiceId,
  weekly: WeeklyFields,
  custom: CustomFields,
});
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;

/** What `schedule.set` may carry: any subset of the settings, `weekly` and `custom` field by field. */
export const ScheduleChange = z.object({
  /** A stored file may hold any zone name (it reads as Stockholm); an edit sets only a listed one. */
  timezone: z.string().refine(isSupportedTimeZone, "an unsupported time zone").optional(),
  hour: ScheduleSettings.shape.hour.optional(),
  cadence_days: CadenceDays.optional(),
  skip_topics: ScheduleSettings.shape.skip_topics.optional(),
  length_minutes: ScheduleLengthMinutes.optional(),
  voice_id: VoiceId.optional(),
  voice_id_b: VoiceId.optional(),
  weekly: WeeklyFields.partial().optional(),
  custom: CustomFields.partial().optional(),
});
export type ScheduleChange = z.infer<typeof ScheduleChange>;
