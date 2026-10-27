import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES, DEFAULT_SCHEDULE, ScheduleFile, scheduleZone } from "@singularity/core";

export class ScheduleError extends Error {
  constructor(problems: string[]) {
    super(`${CONFIG_FILES.schedule} is invalid: ${problems.slice(0, 5).join("; ")}`);
    this.name = "ScheduleError";
  }
}

/** config/schedule.json as written, or null when it does not exist yet. */
export async function loadScheduleFile(root: string): Promise<ScheduleFile | null> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.schedule), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ScheduleError(["not valid JSON"]);
  }
  const parsed = ScheduleFile.safeParse(json);
  if (!parsed.success) {
    throw new ScheduleError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** The schedule a run follows: the file, or the defaults when there is none. */
export async function loadSchedule(root: string): Promise<ScheduleFile> {
  return (await loadScheduleFile(root)) ?? DEFAULT_SCHEDULE;
}

/**
 * The time zone the schedule counts in, for a command that dates a digest outside the gate.
 * Stockholm when the file is missing, does not parse or names a zone outside the list.
 */
export async function loadScheduleZone(root: string): Promise<string> {
  try {
    return scheduleZone((await loadScheduleFile(root))?.timezone);
  } catch {
    return scheduleZone(undefined);
  }
}

/** Stable text for the file: fields in schema order, two-space indent, trailing newline. */
export function serializeSchedule(file: ScheduleFile): string {
  const checked = ScheduleFile.parse(file);
  return `${JSON.stringify(
    {
      version: checked.version,
      timezone: checked.timezone,
      // Written only once off, so a file from before the switch reads and writes as it did.
      ...(checked.enabled ? {} : { enabled: false }),
      hour: checked.hour,
      cadence_days: checked.cadence_days,
      skip_topics: checked.skip_topics,
      length_minutes: checked.length_minutes,
      voice_id: checked.voice_id,
      voice_id_b: checked.voice_id_b,
      // Written only once set, so a file from before the lookback reads and writes as it did.
      ...(checked.lookback_hours == null ? {} : { lookback_hours: checked.lookback_hours }),
      weekly: {
        enabled: checked.weekly.enabled,
        day: checked.weekly.day,
        hour: checked.weekly.hour,
        skip_topics: checked.weekly.skip_topics,
        format: checked.weekly.format,
        length_minutes: checked.weekly.length_minutes,
        voice_id: checked.weekly.voice_id,
        voice_id_b: checked.weekly.voice_id_b,
        ...(checked.weekly.lookback_hours == null
          ? {}
          : { lookback_hours: checked.weekly.lookback_hours }),
      },
      custom: {
        skip_topics: checked.custom.skip_topics,
        format: checked.custom.format,
        length_minutes: checked.custom.length_minutes,
        voice_id: checked.custom.voice_id,
        voice_id_b: checked.custom.voice_id_b,
      },
      ...(checked.general_scoped === true ? { general_scoped: true } : {}),
    },
    null,
    2,
  )}\n`;
}
