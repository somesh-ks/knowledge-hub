import { SECTION_TITLES, SECTIONS } from "@dispatch/core";
import type { PodcastRequest } from "../types/contracts";
import { CHARS_PER_MINUTE } from "./episodeFile";
import { pluralize } from "./format";

/**
 * What the Create page offers, and what it says about a choice. Build time only: the page script
 * ships to the browser on its own and reads the pace from the markup, so the two cannot drift.
 */

// The limits the server enforces, so the form can never offer more than it accepts.
export { MAX_TITLE_CHARS, MAX_TOPICS } from "../server/podcast";

export const LENGTHS: ReadonlyArray<{ value: PodcastRequest["length_minutes"]; label: string }> = [
  { value: 3, label: "3 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
];

export const FORMATS: ReadonlyArray<{
  value: PodcastRequest["format"];
  label: string;
  hint: string;
}> = [
  { value: "readout", label: "Readout", hint: "One host tells each story." },
  { value: "discussion", label: "Discussion", hint: "Two hosts talk it through." },
  { value: "headlines", label: "Headlines", hint: "Quick hits, a line or two each." },
];

export const WINDOWS: ReadonlyArray<{ value: PodcastRequest["window_days"]; label: string }> = [
  { value: 2, label: "2 days" },
  { value: 7, label: "A week" },
  { value: 30, label: "A month" },
];

export const TONES: ReadonlyArray<{ value: PodcastRequest["tone"]; label: string }> = [
  { value: "neutral", label: "Neutral" },
  { value: "energetic", label: "Energetic" },
  { value: "dry", label: "Dry" },
];

export const DEFAULTS = { length: 5, format: "readout", window: 7, tone: "neutral" } as const;

/** "About 5 minutes, roughly 4,800 characters of narration." */
export function estimateText(minutes: number): string {
  const characters = (minutes * CHARS_PER_MINUTE).toLocaleString("en-US");
  return `About ${pluralize(minutes, "minute")}, roughly ${characters} characters of narration.`;
}

export interface TopicOption {
  /** A section id: built in, or one that came with a topic the owner added. */
  value: string;
  label: string;
}

/**
 * The topics to offer: the sections that appear in published briefings, in the order a briefing
 * lists them. With no briefing published yet there is nothing to go by, so every section is offered.
 */
export function topicOptions(appearing: Iterable<{ id: string; title: string }>): TopicOption[] {
  const titles = new Map<string, string>();
  for (const section of appearing)
    if (!titles.has(section.id)) titles.set(section.id, section.title);
  if (titles.size === 0)
    return SECTIONS.map((slug) => ({ value: slug, label: SECTION_TITLES[slug] }));
  // The built-in sections keep their usual order; sections that came with a topic the owner added
  // follow, in the order they first appear.
  const builtin = SECTIONS.filter((slug) => titles.has(slug)).map((slug) => ({
    value: slug as string,
    label: SECTION_TITLES[slug],
  }));
  const known = new Set<string>(SECTIONS);
  const custom = [...titles]
    .filter(([id]) => !known.has(id))
    .map(([value, label]) => ({ value, label }));
  return [...builtin, ...custom];
}
