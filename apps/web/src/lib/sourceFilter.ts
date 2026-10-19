/**
 * The search and filters on Topics & Sources and on each topic's page. Pure, so the build (which
 * writes each row's search text and flags) and the page script (which filters as you type) agree.
 * Imports no runtime from core: the page script loads this file.
 */
import type { SourceFormat } from "@dispatch/core";

export const FORMAT_LABEL: Record<SourceFormat, string> = {
  blog: "Blog",
  news: "News",
  forum: "Forum",
  video: "Video",
  research: "Research",
  releases: "Releases",
  podcast: "Podcast",
};

export const STATUS_LABEL = { off: "Off", failing: "Failing", unscored: "Not scored" } as const;
export type StatusKey = keyof typeof STATUS_LABEL;

/** Lowercase, accents removed: "Café" and "cafe" are one word. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** What the search matches in a source: its name, address and topic name. */
export function searchText(source: { name: string; url: string | null; host: string }, topic: string): string {
  return fold(`${source.name} ${source.host} ${source.url ?? ""} ${topic}`);
}

/** The statuses a source has: switched off, failing to load, or too new to have a score. */
export function statusesOf(source: {
  enabled: boolean;
  struggling: boolean;
  score: number | null;
}): StatusKey[] {
  return [
    ...(source.enabled ? [] : (["off"] as const)),
    ...(source.struggling ? (["failing"] as const) : []),
    ...(source.score === null ? (["unscored"] as const) : []),
  ];
}

export interface FilterState {
  q: string;
  formats: string[];
  statuses: string[];
}

export interface FilterRow {
  text: string;
  format: string;
  statuses: readonly string[];
}

export const NO_FILTER: FilterState = { q: "", formats: [], statuses: [] };

/** True when nothing narrows the list. */
export function isIdle(state: FilterState): boolean {
  return fold(state.q) === "" && state.formats.length === 0 && state.statuses.length === 0;
}

/**
 * Whether a row passes: every word of the query is in its text, one of the chosen formats (if any)
 * is its format, and one of the chosen statuses (if any) is one of its own. A group left out of
 * `skip` is not applied, so a chip's count can say how many rows it would leave.
 */
export function passes(row: FilterRow, state: FilterState, skip?: "format" | "status"): boolean {
  const words = fold(state.q).split(" ").filter(Boolean);
  if (!words.every((word) => row.text.includes(word))) return false;
  if (skip !== "format" && state.formats.length > 0 && !state.formats.includes(row.format)) {
    return false;
  }
  if (
    skip !== "status" &&
    state.statuses.length > 0 &&
    !state.statuses.some((status) => row.statuses.includes(status))
  ) {
    return false;
  }
  return true;
}

/** `?q=&format=&format=&status=` from a location's search string. */
export function readFilter(search: string): FilterState {
  const params = new URLSearchParams(search);
  return { q: params.get("q") ?? "", formats: params.getAll("format"), statuses: params.getAll("status") };
}

/** The search string for a state; empty when nothing is set. */
export function writeFilter(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.q.trim() !== "") params.set("q", state.q);
  for (const format of state.formats) params.append("format", format);
  for (const status of state.statuses) params.append("status", status);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
