/**
 * What the Settings rows say about the pages behind them, in a few words: "Every second day at
 * 07:00", "Sundays at 07:00", "Anthropic, Claude Sonnet 5.5", "9 topics · 11 sources". No DOM and only
 * DOM-free imports (as nextRun.ts), so the build writes each line into the page and the browser
 * works the same line out again from an edit saved since the build (scripts/settingsSaved.ts).
 */
import { SUPPORTED_TIMEZONES, scheduleZone, TIME_ZONE } from "@dispatch/core/time";
import { hourLabel, WEEKDAYS } from "./nextRun";

export const CADENCES = [
  { days: 1, label: "Every day" },
  { days: 2, label: "Every second day" },
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

/** "Every second day at 07:00", "Every second day at 09:00 (New York)". */
export function dailySummary(input: {
  hour: number;
  cadenceDays: number;
  timezone?: string;
}): string {
  const cadence =
    CADENCES.find((entry) => entry.days === input.cadenceDays)?.label ??
    `Every ${input.cadenceDays} days`;
  return `${cadence} at ${hourLabel(input.hour)}${zoneNote(input.timezone)}`;
}

/** "Sundays at 07:00", "Sundays at 07:00 (Tokyo)". The weekly podcast is always on. */
export function weeklySummary(input: { day: number; hour: number; timezone?: string }): string {
  const day = WEEKDAYS[input.day] ?? WEEKDAYS[0];
  return `${day}s at ${hourLabel(input.hour)}${zoneNote(input.timezone)}`;
}

/** A Speechify voice id as a name: "geffen_32" is Geffen. Empty is the default voice. */
function voiceName(id: string): string {
  const name = id.replace(/[_-]\d+$/, "").replaceAll(/[_-]+/g, " ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Default";
}

/** "Alicia and Dominic", "Default voices": the Podcast voice row's line. */
export function voicesSummary(primary: string, secondary: string): string {
  if (!primary && !secondary) return "Default voices";
  return `${voiceName(primary)} and ${voiceName(secondary)}`;
}

/** "9 topics · 11 sources": how many there are, not how many are read. */
export function topicsSummary(topics: number, sources: number): string {
  return `${plural(topics, "topic")} · ${plural(sources, "source")}`;
}

/**
 * What a topic's row says about its sources, counting the ones that are read: "3 sources" when all
 * are on, "2 of 3 sources on" when some are off, "No sources yet" with none, and "Never in a
 * briefing" for a topic that never publishes.
 */
export function sourcesSummary(input: { total: number; on?: number; never?: boolean }): string {
  const { total, on = total } = input;
  if (input.never) return "Never in a briefing";
  if (total === 0) return "No sources yet";
  return on === total ? plural(total, "source") : `${on} of ${plural(total, "source")} on`;
}
