import {
  daysBetween,
  type LastRunFile,
  TIME_ZONE,
  weekday,
  zonedDate,
  zonedHour,
} from "@singularity/core";

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
  /**
   * The schedule's time zone (IANA): the date, the weekly slot's day and hour and the last-run dates
   * are all read on its clock. Defaults to Stockholm.
   */
  zone?: string;
}

/** When the weekly pass is due: a day of the week and an hour, in the schedule's zone. */
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
  /** Calendar date, in the schedule's zone, the decision was made for. */
  date: string;
}

/** Default days between regular digests: due two or more calendar days after the last. */
export const REGULAR_CADENCE_DAYS = 2;

const LEGACY_WEEKLY: WeeklySlot = { enabled: true, day: 0, hour: 0 };

/**
 * Date, in `zone`, of the last regular run that counts toward the cadence. A run counts when it
 * evaluated candidates (published or nothing); a failed or gated record never does, so the next
 * trigger retries.
 */
function lastRegularDate(lastRun: LastRunFile, zone: string): string | undefined {
  const record = lastRun.regular;
  if (!record) return undefined;
  if (record.outcome !== "published" && record.outcome !== "nothing") return undefined;
  const at = new Date(record.at);
  return Number.isNaN(at.getTime()) ? undefined : zonedDate(at, zone);
}

/**
 * Date, in `zone`, of the last weekly pass that published. The weekly podcast stands in for a
 * briefing (it takes its day), so the daily cadence counts from it as from a briefing. One that
 * found nothing gave the listener nothing, so it does not count.
 */
function lastWeeklyDate(lastRun: LastRunFile, zone: string): string | undefined {
  const record = lastRun.weekly;
  if (!record || record.outcome !== "published") return undefined;
  const at = new Date(record.at);
  return Number.isNaN(at.getTime()) ? undefined : zonedDate(at, zone);
}

function weeklyAlreadyRanOn(lastRun: LastRunFile, date: string, zone: string): boolean {
  const record = lastRun.weekly;
  if (!record || (record.outcome !== "published" && record.outcome !== "nothing")) return false;
  return zonedDate(new Date(record.at), zone) === date;
}

/**
 * The gate. It compares calendar dates in the schedule's zone, never elapsed hours, so a cron delayed by
 * several hours still lands on its own date and the 23 and 25 hour days at daylight saving
 * changeovers cannot cost a cycle. The weekly pass has its own slot (day and hour, in the same
 * zone) and is idempotent per date, even when forced. The two never share a day: while the weekly
 * podcast is on, its day has no scheduled briefing, and the daily cadence counts from the later of
 * the last briefing and the last weekly podcast, so the briefing after a weekly one keeps the
 * cadence's spacing. A forced or on-demand run is the owner asking, and still runs.
 */
export function decideRun({
  now,
  mode,
  lastRun,
  force,
  cadenceDays = REGULAR_CADENCE_DAYS,
  weekly = LEGACY_WEEKLY,
  zone = TIME_ZONE,
}: DecideRunInput): RunDecision {
  const date = zonedDate(now, zone);
  const weeklyDay = weekly.enabled && weekday(date) === weekly.day;
  const inWeeklySlot = weeklyDay && zonedHour(now, zone) >= weekly.hour;

  if (mode === "weekly") {
    return { due: false, runWeekly: true, reason: "weekly pass requested", date };
  }
  if (mode === "on-demand") {
    return { due: true, runWeekly: false, reason: "on-demand run ignores the gate", date };
  }

  const weeklyDue = inWeeklySlot && !weeklyAlreadyRanOn(lastRun, date, zone);
  if (force) {
    return { due: true, runWeekly: weeklyDue, reason: "forced run ignores the gate", date };
  }

  if (weeklyDay) {
    return {
      due: false,
      runWeekly: weeklyDue,
      reason: "today is the weekly podcast's day; no briefing",
      date,
    };
  }

  const regular = lastRegularDate(lastRun, zone);
  const weeklyRan = lastWeeklyDate(lastRun, zone);
  const fromWeekly = weeklyRan !== undefined && (regular === undefined || weeklyRan > regular);
  const last = fromWeekly ? weeklyRan : regular;
  if (last === undefined) {
    return { due: true, runWeekly: weeklyDue, reason: "no regular digest has run yet", date };
  }
  const what = fromWeekly ? "last podcast was the weekly one on" : "last regular digest was";
  const elapsed = daysBetween(last, date);
  if (elapsed >= cadenceDays) {
    return {
      due: true,
      runWeekly: weeklyDue,
      reason: `${what} ${last}, ${elapsed} days ago`,
      date,
    };
  }
  const reason =
    elapsed < 0
      ? `${fromWeekly ? "last weekly podcast" : "last regular digest"} is dated ${last}, after today; waiting`
      : `${what} ${last}; next is due ${cadenceDays - elapsed} day(s) from now`;
  return { due: false, runWeekly: weeklyDue, reason, date };
}
