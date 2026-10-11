import { daysBetween, type SourceStat, type SourceStatsFile } from "@dispatch/core";

/** The window a source's counters cover. */
export const STATS_WINDOW_DAYS = 30;

/** What the pipeline knows about one source in one pass, before anything is published. */
export interface SourceCounts {
  /** Items the source returned to the fetch stage. */
  fetched: number;
  /** Pool items from the source that a judge answered. */
  judged: number;
  /** Judged items that cleared the score bar. */
  passed: number;
  /**
   * Judged items the judge flagged as hype or sponsored. Absent from a pass file written before
   * flags were counted.
   */
  flagged?: number;
}

const ZERO: Omit<SourceStat, "window_start"> = { fetched: 0, judged: 0, passed: 0, published: 0 };

/**
 * Roll a source's window forward. Inside 30 days the counters stand. Past that they are halved and
 * the window restarts today, so recent runs outweigh old ones without storing a log of days. A
 * record that never counted flags keeps no `flagged`.
 */
export function rollWindow(stat: SourceStat, today: string): SourceStat {
  if (daysBetween(stat.window_start, today) < STATS_WINDOW_DAYS) return stat;
  return {
    fetched: Math.floor(stat.fetched / 2),
    judged: Math.floor(stat.judged / 2),
    passed: Math.floor(stat.passed / 2),
    published: Math.floor(stat.published / 2),
    ...(stat.flagged === undefined ? {} : { flagged: Math.floor(stat.flagged / 2) }),
    window_start: today,
  };
}

/**
 * Add one pass to the counters. `publishedSourceIds` lists the source of each story that reached
 * the digest (a source appears once per story). Sources with no activity are left alone.
 *
 * `flagged` starts with the first pass that counted it, so a record written before flags were
 * counted gains one then; until then the source score treats its trust as not measured.
 */
export function recordSourceStats(
  file: SourceStatsFile,
  counts: Readonly<Record<string, SourceCounts>>,
  publishedSourceIds: readonly string[],
  today: string,
): SourceStatsFile {
  const published = new Map<string, number>();
  for (const id of publishedSourceIds) published.set(id, (published.get(id) ?? 0) + 1);
  const ids = new Set([...Object.keys(counts), ...published.keys()]);
  const sources = { ...file.sources };
  for (const id of ids) {
    const before = rollWindow(sources[id] ?? { ...ZERO, window_start: today }, today);
    const add = counts[id];
    const flagged =
      add?.flagged === undefined ? before.flagged : (before.flagged ?? 0) + add.flagged;
    sources[id] = {
      fetched: before.fetched + (add?.fetched ?? 0),
      judged: before.judged + (add?.judged ?? 0),
      passed: before.passed + (add?.passed ?? 0),
      published: before.published + (published.get(id) ?? 0),
      ...(flagged === undefined ? {} : { flagged }),
      window_start: before.window_start,
    };
  }
  return { version: 1, sources };
}

/** Share of judged items that passed, or null when nothing was judged yet. */
export function passRate(stat: SourceStat | undefined): number | null {
  if (!stat || stat.judged === 0) return null;
  return Math.min(1, stat.passed / stat.judged);
}
