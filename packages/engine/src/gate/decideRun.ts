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
  /**
   * The daily briefing's hour in the zone. With it, a scheduled run is told when to publish
   * (`publishAt`); left out, the daily one has no publish time.
   */
  hour?: number;
  /** False when the daily briefing is switched off: a scheduled run makes none. Defaults to on. */
  dailyEnabled?: boolean;
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
  /**
   * The instant the run commits: the top of the scheduled hour less DEPLOY_LEAD_MS, so the site
   * shows the briefing by the hour. A run that starts after it commits as soon as it is ready. Null when nothing is scheduled: an on-demand,
   * forced or weekly-mode run, or a daily run decided without `hour`.
   */
  publishAt: Date | null;
}

/**
 * Hours before the scheduled hour a run may start, to generate ahead and publish on time (D193).
 * Vercel Cron lands anywhere in its hour and GitHub starts runs hours late, so a run that starts
 * at the scheduled hour cannot publish at it.
 */
export const GENERATE_AHEAD_HOURS = 2;

/**
 * The commit goes this long before the scheduled time: Vercel deploys a commit in about 35 seconds
 * to 2 minutes, and the site must show the briefing by the slot. The digest's own time stays the slot.
 */
export const DEPLOY_LEAD_MS = 3 * 60_000;

const HOUR_MS = 3_600_000;

/** The top of local `hour` in `zone` on the date `now` falls in. */
function instantAtHour(now: Date, zone: string, hour: number): Date {
  const base = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const first = base + (hour - zonedHour(now, zone) - 1) * HOUR_MS;
  for (let at = first; at <= first + 3 * HOUR_MS; at += 15 * 60_000) {
    const topOfHour =
      zonedHour(new Date(at), zone) === hour && zonedHour(new Date(at - 60_000), zone) !== hour;
    if (topOfHour) return new Date(at);
  }
  return new Date(base);
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
  if (record?.outcome !== "published") return undefined;
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
  hour,
  dailyEnabled = true,
}: DecideRunInput): RunDecision {
  const date = zonedDate(now, zone);
  const weeklyDay = weekly.enabled && weekday(date) === weekly.day;
  const inWeeklySlot =
    weeklyDay && zonedHour(now, zone) >= Math.max(0, weekly.hour - GENERATE_AHEAD_HOURS);
  const commitAt = (at: number): Date =>
    new Date(instantAtHour(now, zone, at).getTime() - DEPLOY_LEAD_MS);
  const weeklyAt = commitAt(weekly.hour);
  const dailyAt = hour === undefined ? null : commitAt(hour);

  if (mode === "weekly") {
    return { due: false, runWeekly: true, reason: "weekly pass requested", date, publishAt: null };
  }
  if (mode === "on-demand") {
    return {
      due: true,
      runWeekly: false,
      reason: "on-demand run ignores the gate",
      date,
      publishAt: null,
    };
  }

  const weeklyDue = inWeeklySlot && !weeklyAlreadyRanOn(lastRun, date, zone);
  // Force bypasses the cadence, never the switch: an off briefing is not generated.
  if (!dailyEnabled) {
    return {
      due: false,
      runWeekly: weeklyDue,
      reason: "the daily briefing is switched off",
      date,
      publishAt: weeklyDue ? weeklyAt : null,
    };
  }

  if (force) {
    return {
      due: true,
      runWeekly: weeklyDue,
      reason: "forced run ignores the gate",
      date,
      publishAt: null,
    };
  }

  if (weeklyDay) {
    return {
      due: false,
      runWeekly: weeklyDue,
      reason: "today is the weekly podcast's day; no briefing",
      date,
      publishAt: weeklyDue ? weeklyAt : null,
    };
  }

  const regular = lastRegularDate(lastRun, zone);
  const weeklyRan = lastWeeklyDate(lastRun, zone);
  const fromWeekly = weeklyRan !== undefined && (regular === undefined || weeklyRan > regular);
  const last = fromWeekly ? weeklyRan : regular;
  if (last === undefined) {
    return {
      due: true,
      runWeekly: weeklyDue,
      reason: "no regular digest has run yet",
      date,
      publishAt: dailyAt,
    };
  }
  const what = fromWeekly ? "last podcast was the weekly one on" : "last regular digest was";
  const elapsed = daysBetween(last, date);
  if (elapsed >= cadenceDays) {
    return {
      due: true,
      runWeekly: weeklyDue,
      reason: `${what} ${last}, ${elapsed} days ago`,
      date,
      publishAt: dailyAt,
    };
  }
  const reason =
    elapsed < 0
      ? `${fromWeekly ? "last weekly podcast" : "last regular digest"} is dated ${last}, after today; waiting`
      : `${what} ${last}; next is due ${cadenceDays - elapsed} day(s) from now`;
  return { due: false, runWeekly: weeklyDue, reason, date, publishAt: null };
}
