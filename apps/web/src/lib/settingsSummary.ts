/**
 * What the Settings rows say about the pages behind them, in a few words: "Every second day at
 * 07:00", "Sundays at 07:00", "Nebius, Default", "9 topics · 11 sources". No DOM and only
 * DOM-free imports (as nextRun.ts), so the build writes each line into the page and the browser
 * works the same line out again from an edit saved since the build (scripts/settingsSaved.ts).
 */
import { SUPPORTED_TIMEZONES, scheduleZone, TIME_ZONE } from "@dispatch/core/time";
import { CLAUDE_MODELS, nebiusName } from "./modelId";
import { hourLabel, WEEKDAYS } from "./nextRun";

export type Provider = "nebius" | "anthropic";

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

/** "Sundays at 07:00", "Sundays at 07:00 (Tokyo)", or "Off". */
export function weeklySummary(input: {
  enabled: boolean;
  day: number;
  hour: number;
  timezone?: string;
}): string {
  const day = WEEKDAYS[input.day];
  if (!input.enabled || !day) return "Off";
  return `${day}s at ${hourLabel(input.hour)}${zoneNote(input.timezone)}`;
}

/**
 * Daily's Repeat row, while the weekly podcast is on: the day it takes the daily one's place. Null
 * while it is off, when there is nothing to say.
 */
export function weeklyNote(input: { enabled: boolean; day: number }): string | null {
  const day = WEEKDAYS[input.day];
  if (!input.enabled || !day) return null;
  return `On ${day}s the weekly episode replaces this one.`;
}

/** The name the Settings row and the Model field show, the same one the model list uses. */
export function writerLabel(model: string | null, provider: Provider = "nebius"): string {
  if (model === null) return "Default";
  if (provider === "anthropic") {
    return CLAUDE_MODELS.find((entry) => entry.id === model)?.label ?? model;
  }
  return nebiusName(model);
}

/** "Nebius, Default", "Anthropic, Claude Sonnet 5.5". */
export function modelSummary(provider: Provider, model: string | null): string {
  return `${provider === "anthropic" ? "Anthropic" : "Nebius"}, ${writerLabel(model, provider)}`;
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
