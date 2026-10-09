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
  /**
   * The weekly podcast's own slot, from config/schedule.json. Left out, a weekly pass is due on
   * any Sunday at any hour, as it was before the slot could be chosen.
   */
  weekly?: WeeklySlot;
}

/** When the weekly pass is due: a day of the week and an hour, in Stockholm time. */
export interface WeeklySlot {
  enabled: boolean;
  /** 0 = Sunday. */
  day: number;
  /** Whole hour; the pass is due from this hour on, so a delayed cron still lands on its day. */
  hour: number;
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

const LEGACY_WEEKLY: WeeklySlot = { enabled: true, day: 0, hour: 0 };

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Whole hour of an instant in Stockholm time, 0 to 23. */
function stockholmHour(at: Date): number {
  return Number(hourFormat.format(at));
}

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
 * changeovers cannot cost a cycle. The weekly pass has its own slot (day and hour, Stockholm
 * time) apart from the daily cadence, and is idempotent per date, even when forced.
 */
export function decideRun({
  now,
  mode,
  lastRun,
  force,
  cadenceDays = REGULAR_CADENCE_DAYS,
  weekly = LEGACY_WEEKLY,
}: DecideRunInput): RunDecision {
  const date = stockholmDate(now);
  const inWeeklySlot =
    weekly.enabled && weekday(date) === weekly.day && stockholmHour(now) >= weekly.hour;

  if (mode === "weekly") {
    return { due: false, runWeekly: true, reason: "weekly pass requested", date };
  }
  if (mode === "on-demand") {
    return { due: true, runWeekly: false, reason: "on-demand run ignores the gate", date };
  }

  const weeklyDue = inWeeklySlot && !weeklyAlreadyRanOn(lastRun, date);
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
