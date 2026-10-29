import type { GenerationRow } from "../types/contracts";

/**
 * What a row of the podcast queue is called. Never the title the writer gave the episode: a name
 * says which podcast it is, so the same words come back on every device and on every poll, and a
 * row does not change width when the live title arrives. `Daily podcast · 7 Oct`,
 * `Weekly podcast · W24` (ISO week), `Catch up · 7 Oct`; a podcast made on request is just
 * `Podcast · 7 Oct`. Pure, so the queue's script carries only the DOM and the words (the panel's
 * data attributes) are passed in.
 */

export interface QueueWords {
  daily: string;
  weekly: string;
  podcast: string;
  catchUp: string;
}

/** Three letters, in English, whatever the browser's language: the names are fixed text. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DIGEST = /^(\d{4})-(\d{2})-(\d{2})(-weekly|-\d+)?$/;
/** `ep-YYYYMMDD-HHmm`, in Stockholm time (core's EpisodeId). */
const EPISODE = /^ep-(\d{4})(\d{2})(\d{2})-\d{4}$/;

/** The ISO 8601 week number of a calendar date: Monday starts the week, week 1 holds the year's first Thursday. */
export function isoWeek(year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const first = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - first) / 86_400_000 + 1) / 7);
}

/** The calendar day an instant falls on in `zone` (the browser's when absent), and its time of day. */
function inZone(
  instant: string,
  zone?: string,
): { month: number; day: number; clock: string } | null {
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(zone ? { timeZone: zone } : {}),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const of = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    month: Number(of("month")),
    day: Number(of("day")),
    clock: `${of("hour")}:${of("minute")}`,
  };
}

const label = (month: number, day: number): string => `${day} ${MONTHS[month - 1] ?? ""}`;

type Named = Pick<GenerationRow, "kind" | "target" | "started_at">;

/**
 * The name of one row. A regeneration is named for the podcast it replaces (its date, or its ISO
 * week for a Weekly); a Catch up for the day it was started in `zone`, the browser's by default.
 * A regeneration that does not say which podcast it replaces is named for the day it was started.
 */
export function queueName(row: Named, words: QueueWords, zone?: string): string {
  const digest = row.target ? DIGEST.exec(row.target) : null;
  if (digest) {
    const [, year, month, day, suffix] = digest;
    if (suffix === "-weekly") {
      return `${words.weekly} · W${isoWeek(Number(year), Number(month), Number(day))}`;
    }
    const noun = suffix ? words.podcast : words.daily;
    return `${noun} · ${label(Number(month), Number(day))}`;
  }
  const episode = row.target ? EPISODE.exec(row.target) : null;
  if (episode) return `${words.catchUp} · ${label(Number(episode[2]), Number(episode[3]))}`;
  const started = inZone(row.started_at, zone);
  const noun = row.kind === "catch_up" ? words.catchUp : words.podcast;
  return started ? `${noun} · ${label(started.month, started.day)}` : noun;
}

/**
 * The names of a whole queue, in order. Two rows that would read the same (two Catch ups on one
 * day, which the cap allows) get the hour they were started added, `Catch up · 7 Oct · 14:05`, and
 * only those two: a name that is unique stays short.
 */
export function queueNames(rows: readonly Named[], words: QueueWords, zone?: string): string[] {
  const names = rows.map((row) => queueName(row, words, zone));
  return names.map((name, index) => {
    if (names.indexOf(name) === names.lastIndexOf(name)) return name;
    const started = inZone(rows[index]?.started_at ?? "", zone);
    return started ? `${name} · ${started.clock}` : name;
  });
}

/** The time of day an instant falls on in `zone` (the browser's when absent), `14:05`: when a finished row says it ended. */
export function clockTime(instant: number, zone?: string): string {
  return inZone(new Date(instant).toISOString(), zone)?.clock ?? "";
}
