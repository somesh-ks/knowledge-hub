import { daysBetween, type JudgmentsFile, type SeenFile, stockholmDate } from "@singularity/core";

export const SEEN_RETENTION_DAYS = 90;
export const JUDGMENT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

/** Drop seen entries dated more than 90 days before today (Stockholm). The 90th day is kept. */
export function pruneSeen(seen: SeenFile, now: Date): SeenFile {
  const today = stockholmDate(now);
  const items = Object.fromEntries(
    Object.entries(seen.items).filter(
      ([, date]) => daysBetween(date, today) <= SEEN_RETENTION_DAYS,
    ),
  );
  return { ...seen, items };
}

/** Drop judgments made more than 30 days ago. An unreadable timestamp is treated as expired. */
export function pruneJudgments(judgments: JudgmentsFile, now: Date): JudgmentsFile {
  const cutoff = now.getTime() - JUDGMENT_RETENTION_DAYS * DAY_MS;
  const entries = Object.fromEntries(
    Object.entries(judgments.entries).filter(([, entry]) => Date.parse(entry.judged_at) >= cutoff),
  );
  return { ...judgments, entries };
}

/** Record item ids as shown in a briefing on `date` (YYYY-MM-DD). Existing dates are kept. */
export function markSeen(seen: SeenFile, ids: Iterable<string>, date: string): SeenFile {
  const items = { ...seen.items };
  for (const id of ids) if (!Object.hasOwn(items, id)) items[id] = date;
  return { ...seen, items };
}
