/**
 * What the Settings rows say about the pages behind them, in a few words: "Every other day at 7",
 * "Sundays at 7", "11 sources". No DOM and only DOM-free imports (as nextRun.ts), so the build writes
 * each line into the page and the browser works the same line out again from an edit saved since
 * the build (scripts/settingsSaved.ts).
 */
import { SUPPORTED_TIMEZONES, scheduleZone, TIME_ZONE } from "@singularity/core/time";
import { WEEKDAYS } from "./nextRun";

export const CADENCES = [
  { days: 1, label: "Every day" },
  { days: 2, label: "Every other day" },
  { days: 3, label: "Every third day" },
  { days: 7, label: "Once a week" },
] as const;

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** " (New York)" after a time in a zone other than Stockholm, the one the owner lives in. */
function zoneNote(timezone: string | undefined): string {
  const zone = scheduleZone(timezone);
  if (zone === TIME_ZONE) return "";
  return ` (${SUPPORTED_TIMEZONES.find((option) => option.value === zone)?.label ?? zone})`;
}

/**
 * An hour as a row's summary says it: the bare 24-hour number, "7" or "19" (2026-10-22, the owner:
 * simpler than 07:00). The Time select itself keeps 07:00.
 */
function summaryHour(hour: number): string {
  return String(hour);
}

/** "Every other day at 7", "Every other day at 9 (New York)". */
export function dailySummary(input: {
  hour: number;
  cadenceDays: number;
  timezone?: string;
}): string {
  const cadence =
    CADENCES.find((entry) => entry.days === input.cadenceDays)?.label ??
    `Every ${input.cadenceDays} days`;
  return `${cadence} at ${summaryHour(input.hour)}${zoneNote(input.timezone)}`;
}

/** "Sundays at 7", "Sundays at 7 (Tokyo)". The weekly podcast is always on. */
export function weeklySummary(input: { day: number; hour: number; timezone?: string }): string {
  const day = WEEKDAYS[input.day] ?? WEEKDAYS[0];
  return `${day}s at ${summaryHour(input.hour)}${zoneNote(input.timezone)}`;
}

/**
 * What a topic's row says about its sources, counting the ones that are read: "3 sources" when all
 * are on, "2 of 3 sources on" when some are off, "No sources yet" with none, and "Never in a
 * briefing" for a topic that never publishes. The Settings index's Sources row passes the total
 * alone: "11 sources".
 */
export function sourcesSummary(input: { total: number; on?: number; never?: boolean }): string {
  const { total, on = total } = input;
  if (input.never) return "Never in a briefing";
  if (total === 0) return "No sources yet";
  return on === total ? plural(total, "source") : `${on} of ${plural(total, "source")} on`;
}
