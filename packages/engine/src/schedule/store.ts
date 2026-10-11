import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES, DEFAULT_SCHEDULE, ScheduleFile } from "@dispatch/core";

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

/** Stable text for the file: fields in schema order, two-space indent, trailing newline. */
export function serializeSchedule(file: ScheduleFile): string {
  const checked = ScheduleFile.parse(file);
  return `${JSON.stringify(
    {
      version: checked.version,
      hour: checked.hour,
      cadence_days: checked.cadence_days,
      sections: checked.sections,
      format: checked.format,
      length_minutes: checked.length_minutes,
      voice_id: checked.voice_id,
      voice_id_b: checked.voice_id_b,
      weekly: {
        enabled: checked.weekly.enabled,
        day: checked.weekly.day,
        hour: checked.weekly.hour,
        sections: checked.weekly.sections,
        format: checked.weekly.format,
        length_minutes: checked.weekly.length_minutes,
        voice_id: checked.weekly.voice_id,
        voice_id_b: checked.weekly.voice_id_b,
      },
      custom: {
        format: checked.custom.format,
        length_minutes: checked.custom.length_minutes,
        voice_id: checked.custom.voice_id,
        voice_id_b: checked.custom.voice_id_b,
      },
    },
    null,
    2,
  )}\n`;
}
