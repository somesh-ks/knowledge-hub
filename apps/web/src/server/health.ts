import {
  compareNewestFirst,
  type Digest,
  dateInZone,
  type LastRunFile,
  type RunRecord,
  type ScheduleFile,
  type SourceHealthFile,
  scheduleZone,
} from "@singularity/core";
import { rateVital, type VitalMetric } from "@singularity/core/vitals";
import { type ClientFaultGroup, OPAQUE_SCRIPT_ERROR } from "@singularity/engine/faults-store";
import { decideRun } from "@singularity/engine/gate";
import {
  CLIENT_ERRORS_PER_DAY,
  FAILURE_FLAG_THRESHOLD,
  FIELD_MIN_SAMPLES,
  PLATFORM_FAULTS_PER_DAY,
  SCRIPT_BLOCKS_PER_DAY,
  SCRIPT_DIRECTIVES,
  SERVER_FAULTS_PER_DAY,
  SHORT_EPISODE_FAULT,
  SHORT_EPISODE_WARN,
  SLOT_MISSED_AFTER_MS,
  THIN_DIGEST_ITEMS,
} from "@singularity/engine/health-limits";
import type { VitalSummary } from "@singularity/engine/vitals-store";
import {
  HEALTH_DEVICES,
  HEALTH_JOBS,
  HEALTH_SPEED,
  type HealthBody,
  type HealthRow,
  type HealthTone,
} from "../lib/healthRows";
import type { WorkflowRun } from "./github";

/**
 * The Health page's answer (/api/health): what `singularity health` judges daily, read live from what
 * the site reaches, with the same lines (`@singularity/engine/health-limits`), plus the readings
 * health only logs: run times, workflow outcomes and the field p75s per device. Pure: the route
 * gathers the inputs (healthSources.ts) and this words every row.
 */

/** Runs and digests this far back count; the field and fault stores keep the same week. */
export const HEALTH_WINDOW_DAYS = 7;
/** How many recent briefings of a kind the run time's median is taken over. */
const TIMED_RUNS = 10;
/** A source not tried for this long is switched off or gone: its old failure count is not today's. */
const SOURCE_ACTIVE_MS = HEALTH_WINDOW_DAYS * 86_400_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A part that did not answer, as opposed to one that answered with nothing. */
export const UNAVAILABLE = "unavailable" as const;
type Maybe<T> = T | typeof UNAVAILABLE | "off";

export interface HealthInput {
  lastRun: LastRunFile | null;
  schedule: ScheduleFile | null;
  /** The newest briefings, any order; the parse failures left out. */
  digests: readonly Digest[];
  sourceHealth: SourceHealthFile | null;
  /** Whether the state came from the content store or this build's copy. */
  stored: boolean;
  /** The store answered from its last manifest, which could not be refreshed (contentRepo.ts). */
  saved?: boolean;
  vitals: Maybe<readonly VitalSummary[]>;
  /** Null: no fault was ever reported (no table yet). */
  faults: Maybe<readonly ClientFaultGroup[] | null>;
  /** Each workflow file's runs in the window. */
  jobs: Maybe<Record<string, readonly WorkflowRun[]>>;
}

// ---- words ---------------------------------------------------------------------------------

/** "Just now", "12 min ago", "5 h ago", "3 d ago". */
export function ago(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(iso));
  if (ms < 60_000) return "Just now";
  if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 2 * DAY_MS) return `${Math.floor(ms / HOUR_MS)} h ago`;
  return `${Math.floor(ms / DAY_MS)} d ago`;
}

/** "45 s", "3.4 min", "1 h 12 min". */
export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR_MS) return `${(ms / 60_000).toFixed(1)} min`;
  return `${Math.floor(ms / HOUR_MS)} h ${Math.round((ms % HOUR_MS) / 60_000)} min`;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
const stories = (count: number): string => (count === 1 ? "1 story" : `${count} stories`);

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const worst = (tones: readonly HealthTone[]): HealthTone =>
  tones.includes("bad")
    ? "bad"
    : tones.includes("warn")
      ? "warn"
      : tones.includes("good")
        ? "good"
        : "none";

const row = (id: string, value: string, detail: string, tone: HealthTone): HealthRow => ({
  id,
  value,
  detail,
  tone,
});

// ---- briefings -----------------------------------------------------------------------------

/**
 * How long a briefing took to make: from its fetch window's end, which is the moment its run started
 * (the run's id), to when generation finished. Never the record's `at`, which for a run started
 * ahead is the publish time an hour or more later (D193: one read 96 minutes for a 3 minute run).
 */
export function briefingTime(digest: Digest): number | null {
  const ms = Date.parse(digest.generated_at) - Date.parse(digest.window.to);
  return Number.isFinite(ms) && ms > 0 && ms < 6 * HOUR_MS ? ms : null;
}

function slotRow(
  id: string,
  record: RunRecord | undefined,
  options: { enabled: boolean; overdueMs: number; missed: boolean; newest: Digest | undefined },
  now: Date,
): HealthRow {
  if (!options.enabled) return row(id, "Off", "Switched off", "none");
  if (options.missed) {
    return row(id, record ? ago(record.at, now) : "Never", "Missed its scheduled time", "bad");
  }
  if (!record) return row(id, "Never", "No run recorded yet", "none");
  const when = ago(record.at, now);
  if (record.outcome === "failed") return row(id, when, "The last run failed", "bad");
  if (now.getTime() - Date.parse(record.at) > options.overdueMs) {
    return row(id, when, "Overdue: no run has published since", "bad");
  }
  if (record.outcome === "nothing") return row(id, when, "Nothing new to publish", "good");
  const count = stories(record.items);
  if (record.items < THIN_DIGEST_ITEMS) {
    return row(id, when, `${count}, under ${THIN_DIGEST_ITEMS}`, "warn");
  }
  if (options.newest && options.newest.id === record.digest_id && !options.newest.verified) {
    return row(id, when, `${count}, not checked against sources`, "warn");
  }
  return row(id, when, count, "good");
}

function briefingRows(input: HealthInput, now: Date): HealthRow[] {
  const { lastRun, schedule, digests } = input;
  const byNewest = [...digests].sort(compareNewestFirst);
  const zone = scheduleZone(schedule?.timezone);
  // A due slot whose publish time passed unpublished is missed the same day (`slot_missed`).
  const due =
    lastRun && schedule
      ? decideRun({
          now,
          mode: "scheduled",
          lastRun,
          force: false,
          cadenceDays: schedule.cadence_days,
          weekly: schedule.weekly,
          zone,
          hour: schedule.hour,
          dailyEnabled: schedule.enabled,
        })
      : null;
  const missed =
    due !== null &&
    due.publishAt !== null &&
    now.getTime() - due.publishAt.getTime() > SLOT_MISSED_AFTER_MS;
  const cadenceDays = schedule?.cadence_days ?? 2;
  const rows = [
    slotRow(
      "daily",
      lastRun?.regular,
      {
        enabled: schedule?.enabled !== false,
        // A day's grace past the cadence: run_overdue counts by date, this by the clock.
        overdueMs: (cadenceDays + 1) * DAY_MS,
        missed: missed && due?.due === true,
        newest: byNewest.find((digest) => digest.kind === "regular"),
      },
      now,
    ),
    slotRow(
      "weekly",
      lastRun?.weekly,
      {
        enabled: schedule?.weekly.enabled !== false,
        overdueMs: 8 * DAY_MS,
        missed: missed && due?.runWeekly === true,
        newest: byNewest.find((digest) => digest.kind === "weekly"),
      },
      now,
    ),
  ];

  const catchUp = lastRun?.on_demand;
  rows.push(
    !catchUp
      ? row("catch_up", "Never", "No episode made yet", "none")
      : catchUp.outcome === "failed"
        ? row("catch_up", ago(catchUp.at, now), "The last one failed", "bad")
        : catchUp.outcome === "nothing"
          ? row("catch_up", ago(catchUp.at, now), "Nothing new to make", "good")
          : row("catch_up", ago(catchUp.at, now), stories(catchUp.items), "good"),
  );

  // The newest briefing's narration against the length its kind is set to (`episode_short`).
  const newest = byNewest[0];
  if (!newest) {
    rows.push(row("narration", "No data", "No podcast found", "none"));
  } else if (!newest.audio) {
    const today = dateInZone(now.toISOString(), zone);
    rows.push(
      newest.date < today
        ? row("narration", "Missing", `${newest.id} has no audio`, "bad")
        : row("narration", "Pending", `${newest.id} is not narrated yet`, "none"),
    );
  } else {
    const minutes =
      newest.kind === "weekly"
        ? schedule?.weekly.length_minutes
        : newest.kind === "regular"
          ? schedule?.length_minutes
          : undefined;
    const aired = newest.audio.duration_ms;
    if (minutes) {
      const share = aired / (minutes * 60_000);
      rows.push(
        row(
          "narration",
          duration(aired),
          `${Math.round(share * 100)}% of its ${minutes} min`,
          share < SHORT_EPISODE_FAULT ? "bad" : share < SHORT_EPISODE_WARN ? "warn" : "good",
        ),
      );
    } else {
      rows.push(row("narration", duration(aired), newest.id, "good"));
    }
  }

  // The engine writes `model_fallback` only when a fallback happened: a run's spend without it is none.
  const spend = lastRun?.spend;
  const fallbacks = spend ? (spend.requests.model_fallback ?? 0) : undefined;
  rows.push(
    fallbacks === undefined
      ? row("fallbacks", "No data", "No run spend recorded", "none")
      : row(
          "fallbacks",
          String(fallbacks),
          fallbacks > 0 ? "In the last run" : "None in the last run",
          fallbacks > 0 ? "warn" : "good",
        ),
  );
  return rows;
}

function timeRows(digests: readonly Digest[]): { rows: HealthRow[]; dailyMedian: number | null } {
  const timed = (kind: Digest["kind"]) =>
    [...digests]
      .filter((digest) => digest.kind === kind)
      .sort(compareNewestFirst)
      .slice(0, TIMED_RUNS)
      .flatMap((digest) => {
        const ms = briefingTime(digest);
        return ms === null ? [] : [ms];
      });
  let dailyMedian: number | null = null;
  const rows = (
    [
      ["time_daily", "regular"],
      ["time_weekly", "weekly"],
    ] as const
  ).map(([id, kind]) => {
    const times = timed(kind);
    const middle = median(times);
    if (kind === "regular") dailyMedian = middle;
    if (middle === null) return row(id, "No data", "No podcast timed yet", "none");
    return row(
      id,
      duration(middle),
      `Last ${duration(times[0] as number)}, median of ${plural(times.length, "run")}`,
      "none",
    );
  });
  return { rows, dailyMedian };
}

// ---- speed ---------------------------------------------------------------------------------

const VITAL_UNIT: Record<VitalMetric, (value: number) => string> = {
  lcp: (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`),
  inp: (ms) => `${Math.round(ms)} ms`,
  cls: (value) => value.toFixed(2),
};
const RATING_WORD = { good: "Good", "needs-improvement": "Needs work", poor: "Poor" } as const;
const RATING_TONE = { good: "good", "needs-improvement": "warn", poor: "bad" } as const;

function speedRows(vitals: HealthInput["vitals"]): HealthRow[] {
  return HEALTH_DEVICES.flatMap((device) =>
    HEALTH_SPEED.map(({ id: metric }) => {
      const id = `${metric}.${device.id}`;
      if (vitals === "off") return row(id, "Not set up", "No database for field data", "none");
      if (vitals === UNAVAILABLE)
        return row(id, "Unavailable", "The database did not answer", "none");
      const summary = vitals.find((each) => each.metric === metric && each.device === device.id);
      if (!summary || summary.samples === 0) {
        return row(id, "No data", "No visits measured this week", "none");
      }
      const value = VITAL_UNIT[metric](summary.p75);
      const visits = plural(summary.samples, "visit");
      // Too few samples say more about one visit than the site: shown, not judged (`field_unmeasured`).
      if (summary.samples < FIELD_MIN_SAMPLES)
        return row(id, value, `Too few to judge, ${visits}`, "none");
      const rating = rateVital(metric, summary.p75);
      return row(id, value, `${RATING_WORD[rating]}, ${visits}`, RATING_TONE[rating]);
    }),
  );
}

// ---- errors --------------------------------------------------------------------------------

function errorRows(faults: HealthInput["faults"]): { rows: HealthRow[]; today: number | null } {
  const kinds = [
    {
      id: "page_errors",
      least: CLIENT_ERRORS_PER_DAY,
      perRoute: true,
      match: (group: ClientFaultGroup) =>
        (group.kind === "error" || group.kind === "rejection") &&
        group.message !== OPAQUE_SCRIPT_ERROR,
    },
    {
      id: "blocked_scripts",
      least: SCRIPT_BLOCKS_PER_DAY,
      perRoute: false,
      match: (group: ClientFaultGroup) =>
        group.kind === "csp" && SCRIPT_DIRECTIVES.has(group.directive),
    },
    {
      id: "server_errors",
      least: SERVER_FAULTS_PER_DAY,
      perRoute: true,
      match: (group: ClientFaultGroup) => group.kind === "server",
    },
    {
      id: "timeouts",
      least: PLATFORM_FAULTS_PER_DAY,
      perRoute: true,
      match: (group: ClientFaultGroup) => group.kind === "platform",
    },
  ];
  if (faults === "off" || faults === UNAVAILABLE) {
    const [value, detail] =
      faults === "off"
        ? ["Not set up", "No database for reports"]
        : ["Unavailable", "The database did not answer"];
    return { rows: kinds.map((kind) => row(kind.id, value, detail, "none")), today: null };
  }
  if (faults === null) {
    return {
      rows: kinds.map((kind) => row(kind.id, "0", "Nothing reported yet", "none")),
      today: 0,
    };
  }
  let today = 0;
  const rows = kinds.map((kind) => {
    const groups = faults.filter(kind.match);
    const day = groups.reduce((sum, group) => sum + group.day, 0);
    const week = groups.reduce((sum, group) => sum + group.total, 0);
    if (kind.id !== "blocked_scripts") today += day;
    // The commonest route over the week names where to look.
    const routes = new Map<string, { day: number; week: number }>();
    for (const group of groups) {
      const seen = routes.get(group.page) ?? { day: 0, week: 0 };
      routes.set(group.page, { day: seen.day + group.day, week: seen.week + group.total });
    }
    const top = [...routes].sort((a, b) => b[1].week - a[1].week)[0];
    const peak = Math.max(0, ...[...routes.values()].map((each) => each.day));
    const over = kind.perRoute ? peak >= kind.least : day >= kind.least;
    const detail =
      week === 0 ? "None this week" : `${week} this week, most on ${top?.[0] ?? "a page"}`;
    return row(kind.id, String(day), detail, over ? "warn" : "good");
  });
  return { rows, today };
}

// ---- jobs ----------------------------------------------------------------------------------

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

function jobRows(jobs: HealthInput["jobs"], now: Date): HealthRow[] {
  return Object.entries(HEALTH_JOBS).map(([id, file]) => {
    if (jobs === "off") return row(id, "Not set up", "No GitHub token", "none");
    if (jobs === UNAVAILABLE) return row(id, "Unavailable", "GitHub did not answer", "none");
    // A workflow GitHub did not list (an error for that one alone) is unavailable, not quiet.
    const runs = jobs[file];
    if (runs === undefined) return row(id, "Unavailable", "GitHub did not answer", "none");
    // Skipped runs are run.yml's hourly ticks outside its slot: no work, no outcome.
    const done = runs.filter(
      (run) =>
        run.status === "completed" && run.conclusion !== null && run.conclusion !== "skipped",
    );
    if (done.length === 0) return row(id, "No runs", "None this week", "none");
    const failed = done.filter((run) => FAILED.has(run.conclusion ?? "")).length;
    const cancelled = done.filter((run) => run.conclusion === "cancelled").length;
    const last = done[0] as WorkflowRun;
    const detail = `${plural(done.length, "run")} this week, last ${ago(last.updatedAt ?? last.createdAt, now).toLowerCase()}`;
    if (FAILED.has(last.conclusion ?? ""))
      return row(id, `${failed} failed`, `The last one failed. ${detail}`, "bad");
    if (failed > 0) return row(id, `${failed} failed`, detail, "warn");
    // GitHub reports a job killed at its timeout as cancelled (`run_cancelled`).
    if (cancelled > 0) return row(id, `${cancelled} cancelled`, detail, "warn");
    return row(id, "All passed", detail, "good");
  });
}

// ---- sources and services ------------------------------------------------------------------

function serviceRows(input: HealthInput, now: Date): HealthRow[] {
  const rows: HealthRow[] = [];
  const health = input.sourceHealth;
  if (!health) {
    rows.push(row("sources", "No data", "No source has been fetched yet", "none"));
  } else {
    const active = Object.entries(health.sources).filter(
      ([, entry]) =>
        entry.last_try && now.getTime() - Date.parse(entry.last_try) < SOURCE_ACTIVE_MS,
    );
    const failing = active
      .filter(([, entry]) => entry.failures >= FAILURE_FLAG_THRESHOLD)
      .sort((a, b) => b[1].failures - a[1].failures);
    rows.push(
      failing.length === 0
        ? row("sources", "All fetching", `${active.length} fetched this week`, "good")
        : row(
            "sources",
            `${failing.length} failing`,
            `${failing
              .slice(0, 3)
              .map(([id]) => id)
              .join(", ")}${failing.length > 3 ? ` and ${failing.length - 3} more` : ""}`,
            "warn",
          ),
    );
  }
  const database = input.vitals;
  rows.push(
    database === "off"
      ? row("database", "Not set up", "Field data and reports are off", "none")
      : database === UNAVAILABLE
        ? row("database", "Not answering", "Rate caps fall back to each instance", "warn")
        : row("database", "Answering", "Field data and reports", "good"),
  );
  rows.push(
    !input.stored
      ? row("content", "Build copy", "The store did not answer: one deploy behind", "warn")
      : input.saved
        ? row(
            "content",
            "Saved copy",
            "The store's list did not refresh: newer items may be missing",
            "warn",
          )
        : row("content", "Answering", "Pages read it live", "good"),
  );
  return rows;
}

// ---- the answer ----------------------------------------------------------------------------

export function healthBody(input: HealthInput, now: Date): HealthBody {
  const briefings = briefingRows(input, now);
  const times = timeRows(input.digests);
  const speed = speedRows(input.vitals);
  const errors = errorRows(input.faults);
  const rows = [
    ...briefings,
    ...times.rows,
    ...speed,
    ...errors.rows,
    ...jobRows(input.jobs, now),
    ...serviceRows(input, now),
  ];
  const flagged = rows.filter((each) => each.tone === "warn" || each.tone === "bad");

  const published = [input.lastRun?.regular, input.lastRun?.weekly]
    .filter((record): record is RunRecord => record?.outcome === "published")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const phoneLoad = speed.find((each) => each.id === "lcp.mobile");
  return {
    checked_at: now.toISOString(),
    attention: { count: flagged.length, tone: worst(flagged.map((each) => each.tone)) },
    tiles: {
      last_briefing: published ? ago(published.at, now) : "None",
      briefing_time: times.dailyMedian === null ? "No data" : duration(times.dailyMedian),
      page_load: phoneLoad && /\d/.test(phoneLoad.value) ? phoneLoad.value : "No data",
      errors_today: errors.today === null ? "No data" : String(errors.today),
    },
    rows,
    parts: {
      content: !input.stored ? "fallback" : input.saved ? "saved" : "ok",
      database:
        input.vitals === "off" ? "off" : input.vitals === UNAVAILABLE ? "unavailable" : "ok",
      github:
        input.jobs === "off"
          ? "off"
          : input.jobs === UNAVAILABLE
            ? "unavailable"
            : Object.values(HEALTH_JOBS).every((file) => file in (input.jobs as object))
              ? "ok"
              : "partial",
    },
  };
}
