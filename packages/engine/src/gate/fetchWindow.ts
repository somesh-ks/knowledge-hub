import type { DigestKind } from "@singularity/core";

export interface FetchWindow {
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;
export const MAX_WINDOW_DAYS = 7;
export const FIRST_RUN_DAYS = 3;
export const WEEKLY_DAYS = 7;

export interface FetchWindowInput {
  /** End of the last successful fetch of any kind, from state/last-run.json. */
  lastFetchAt: Date | undefined;
  now: Date;
  kind: DigestKind;
}

/**
 * The span to fetch. It starts where the last successful fetch ended, so a missed run widens the
 * next one and nothing is lost; overlap is harmless because seen.json removes items already
 * shown. Capped at 7 days, 3 days on the first run, always 7 days for the weekly pass.
 */
export function fetchWindow({ lastFetchAt, now, kind }: FetchWindowInput): FetchWindow {
  if (kind === "weekly") return { from: new Date(now.getTime() - WEEKLY_DAYS * DAY_MS), to: now };
  if (lastFetchAt === undefined) {
    return { from: new Date(now.getTime() - FIRST_RUN_DAYS * DAY_MS), to: now };
  }
  const earliest = now.getTime() - MAX_WINDOW_DAYS * DAY_MS;
  // A last fetch "in the future" is clock skew between machines; treat it as now.
  const from = Math.min(Math.max(lastFetchAt.getTime(), earliest), now.getTime());
  return { from: new Date(from), to: now };
}
