/**
 * The search on Topics & Sources, and the search and format tabs on each topic's page. Pure, so the
 * build (which writes each row's search text and format) and the page script (which filters as you
 * type) agree.
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

/** Lowercase, accents removed: "Café" and "cafe" are one word. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** What the search matches in a source: its name, address and topic name. */
export function searchText(
  source: { name: string; url: string | null; host: string },
  topic: string,
): string {
  return fold(`${source.name} ${source.host} ${source.url ?? ""} ${topic}`);
}

export interface FilterState {
  q: string;
  /** The formats chosen: one tab, or any chips; none is All. */
  formats: string[];
}

export interface FilterRow {
  text: string;
  format: string;
}

/** True when nothing narrows the list. */
export function isIdle(state: FilterState): boolean {
  return fold(state.q) === "" && state.formats.length === 0;
}

/** Whether a row passes: every word of the query is in its text, and its format is one chosen (any, when none is). */
export function passes(row: FilterRow, state: FilterState): boolean {
  const words = fold(state.q).split(" ").filter(Boolean);
  if (!words.every((word) => row.text.includes(word))) return false;
  return state.formats.length === 0 || state.formats.includes(row.format);
}

/** `?q=&format=a&format=b` from a location's search string. */
export function readFilter(search: string): FilterState {
  const params = new URLSearchParams(search);
  return { q: params.get("q") ?? "", formats: params.getAll("format").filter(Boolean) };
}

/** The search string for a state; empty when nothing is set. */
export function writeFilter(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.q.trim() !== "") params.set("q", state.q);
  for (const format of state.formats) params.append("format", format);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
