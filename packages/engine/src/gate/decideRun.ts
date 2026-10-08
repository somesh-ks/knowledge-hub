import { daysBetween, type LastRunFile, stockholmDate, weekday } from "@dispatch/core";

export const RUN_MODES = ["scheduled", "on-demand", "weekly"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface DecideRunInput {
  now: Date;
  mode: RunMode;
  lastRun: LastRunFile;
  /** Ignore the cadence gate. */
  force: boolean;
  /** Days between regular digests, from config/schedule.json. Defaults to REGULAR_CADENCE_DAYS. */
  cadenceDays?: number;
}

export interface RunDecision {
  /** A regular or on-demand digest should be produced. */
  due: boolean;
  /** The weekly pass should run, after the regular one when both are due. */
  runWeekly: boolean;
  /** One sentence for logs and the job summary. */
  reason: string;
  /** Stockholm calendar date the decision was made for. */
  date: string;
}

/** Default days between regular digests: due two or more calendar days after the last. */
export const REGULAR_CADENCE_DAYS = 2;

const SUNDAY = 0;

/**
 * Stockholm date of the last regular run that counts toward the cadence. A run counts when it
 * evaluated candidates (published or nothing); a failed or gated record never does, so the next
 * trigger retries.
 */
function lastRegularDate(lastRun: LastRunFile): string | undefined {
  const record = lastRun.regular;
  if (!record) return undefined;
  if (record.outcome !== "published" && record.outcome !== "nothing") return undefined;
  const at = new Date(record.at);
  return Number.isNaN(at.getTime()) ? undefined : stockholmDate(at);
}

function weeklyAlreadyRanOn(lastRun: LastRunFile, date: string): boolean {
  const record = lastRun.weekly;
  if (!record || (record.outcome !== "published" && record.outcome !== "nothing")) return false;
  return stockholmDate(new Date(record.at)) === date;
}

/**
 * The gate. It compares Stockholm calendar dates, never elapsed hours, so a cron delayed by
 * several hours still lands on its own date and the 23 and 25 hour days at daylight saving
 * changeovers cannot cost a cycle. A weekly pass is idempotent per Sunday, even when forced.
 */
export function decideRun({
  now,
  mode,
  lastRun,
  force,
  cadenceDays = REGULAR_CADENCE_DAYS,
}: DecideRunInput): RunDecision {
  const date = stockholmDate(now);
  const isSunday = weekday(date) === SUNDAY;

  if (mode === "weekly") {
    return { due: false, runWeekly: true, reason: "weekly pass requested", date };
  }
  if (mode === "on-demand") {
    return { due: true, runWeekly: false, reason: "on-demand run ignores the gate", date };
  }

  const weeklyDue = isSunday && !weeklyAlreadyRanOn(lastRun, date);
  if (force) {
    return { due: true, runWeekly: weeklyDue, reason: "forced run ignores the gate", date };
  }

  const last = lastRegularDate(lastRun);
  if (last === undefined) {
    return { due: true, runWeekly: weeklyDue, reason: "no regular digest has run yet", date };
  }
  const elapsed = daysBetween(last, date);
  if (elapsed >= cadenceDays) {
    return {
      due: true,
      runWeekly: weeklyDue,
      reason: `last regular digest was ${last}, ${elapsed} days ago`,
      date,
    };
  }
  const reason =
    elapsed < 0
      ? `last regular digest is dated ${last}, after today; waiting`
      : `last regular digest was ${last}; next is due ${cadenceDays - elapsed} day(s) from now`;
  return { due: false, runWeekly: weeklyDue, reason, date };
}
