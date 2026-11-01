import type { DigestKind, LastRunFile, RunRecord } from "@singularity/core";

export interface RecordRunInput {
  kind: DigestKind;
  record: RunRecord;
  /** End of the fetch window this run covered. Becomes the start of the next one. */
  fetchedThrough?: Date | undefined;
}

type Slot = "regular" | "weekly" | "on_demand";

const SLOT_BY_KIND: Record<DigestKind, Slot> = {
  regular: "regular",
  weekly: "weekly",
  "on-demand": "on_demand",
};

/**
 * The next last-run.json after a run. One slot per kind, so an on-demand run never shifts the
 * regular cadence. Only runs that evaluated candidates (published, nothing) are recorded and
 * advance the fetch window. A failed run leaves the file untouched so the next window grows and
 * nothing is lost (build plan 7.9); a gated run did no work and records nothing.
 */
export function recordRun(lastRun: LastRunFile, input: RecordRunInput): LastRunFile {
  const { record, kind, fetchedThrough } = input;
  if (record.outcome === "failed" || record.outcome === "gated") return lastRun;

  // The slot's window end only moves forward, as last_fetch_at does, even if runs finish out of order.
  const earlier = lastRun[SLOT_BY_KIND[kind]]?.fetched_through;
  const through =
    fetchedThrough && earlier && Date.parse(earlier) > fetchedThrough.getTime()
      ? earlier
      : fetchedThrough?.toISOString();
  const next: LastRunFile = {
    ...lastRun,
    [SLOT_BY_KIND[kind]]: through ? { ...record, fetched_through: through } : record,
  };
  if (fetchedThrough) {
    const previous = lastRun.last_fetch_at
      ? Date.parse(lastRun.last_fetch_at)
      : Number.NEGATIVE_INFINITY;
    // The window start only moves forward, even if runs finish out of order.
    if (fetchedThrough.getTime() > previous) next.last_fetch_at = fetchedThrough.toISOString();
  }
  return next;
}

/**
 * Where a slot's last window ended. A record from before `fetched_through` gives the time its run
 * finished instead, but never later than the last fetch of any kind: the run finished after its
 * window closed, so that time can only be late. With neither, or a failed record without it,
 * nothing is known and the caller keeps its own lookback.
 */
export function windowEndOf(
  record: RunRecord | undefined,
  lastFetchAt: string | undefined,
): string | undefined {
  if (record === undefined) return undefined;
  if (record.fetched_through) return record.fetched_through;
  if (record.outcome === "failed" || lastFetchAt === undefined) return undefined;
  const finished = record.generated_at ?? record.at;
  return Date.parse(finished) < Date.parse(lastFetchAt) ? finished : lastFetchAt;
}

/**
 * The next last-run.json after a run whose job died before the commit stage (an install that
 * failed, a crash): each due kind's slot reads `failed` at `at`, so `health` reports `run_failed`
 * and the gate retries it. The fetch window and the cover stay as they were.
 */
export function recordFailure(
  lastRun: LastRunFile,
  kinds: readonly DigestKind[],
  at: string,
): LastRunFile {
  const next: LastRunFile = { ...lastRun };
  for (const kind of kinds) {
    const slot = SLOT_BY_KIND[kind];
    // The failed slot keeps where the last window ended: the retry must not start later.
    const through = windowEndOf(lastRun[slot], lastRun.last_fetch_at);
    next[slot] = {
      at,
      outcome: "failed",
      items: 0,
      ...(through ? { fetched_through: through } : {}),
    };
  }
  return next;
}
