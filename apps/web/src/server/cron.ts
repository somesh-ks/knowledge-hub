import { createHash, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_SCHEDULE,
  EMPTY_LAST_RUN,
  LastRunFile,
  ScheduleFile,
  scheduleZone,
  stockholmHour,
  weekday,
  zonedDate,
  zonedHour,
} from "@singularity/core";
import { configStoreUrl, type SqlClient } from "@singularity/engine/config-paths";
import { decideRun, GENERATE_AHEAD_HOURS } from "@singularity/engine/gate";
import { readServerConfig, type ServerEnv, secretsOf } from "./config";
import { createGitHubClient, type FetchLike } from "./github";
import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * GET /api/cron/run: what starts the scheduled briefing on time (D61). Since late August 2026
 * GitHub has started this repository's scheduled runs hours late (the 07:13 entry ran between 13:11
 * and 14:02), so Vercel Cron calls this route once in every UTC hour (vercel.json; on the Hobby plan
 * a call lands anywhere in its hour). Each call reads config/schedule.json on main. In the
 * schedule's own hour, in its time zone, which is the daily hour or the weekly slot's hour on its day,
 * it asks the engine's gate, with state/last-run.json, whether anything is due, and only then
 * dispatches run.yml as a scheduled run. The workflow's gate decides again, so a second call in the
 * same hour, or GitHub's own late run, ends gated. A call Vercel never makes is left to that late
 * run.
 */

export type CronBody =
  | { dispatched: true; run_id: number | null; reason: string }
  | { dispatched: false; reason: string }
  | { error: "unauthorized" | "unavailable" | "github_failed" };

export interface CronDeps {
  env: ServerEnv;
  fetch: FetchLike;
  now: () => Date;
  log?: (message: string) => void;
  /** Opens the config store (D149). Tests pass a fake; left out, the Neon driver is used. */
  connectConfigStore?: (databaseUrl: string) => Promise<SqlClient>;
}

/**
 * How long the cron waits for the config store's answer (not its module load) before it reads
 * main instead: well inside the function's limit.
 */
export const STORE_READ_TIMEOUT_MS = 5000;

/**
 * The schedule's text: from the config store when it is on (D149), where an edit to the hour lands
 * at once, while main has it only after the next run; from main when the store is off or cannot
 * be read, so a database outage costs at most an edit's freshness, never the briefing.
 */
async function readSchedule(
  deps: CronDeps,
  github: ReturnType<typeof createGitHubClient>,
): Promise<string | null> {
  const storeUrl = configStoreUrl(deps.env);
  if (storeUrl !== null) {
    try {
      // Loaded only with the store on, so the function never loads the driver while it is off.
      // A database that hangs must not spend the call: Vercel makes one an hour. The wait counts
      // from the query, not the module load: the load is local code, and a slow cold start (or a
      // loaded host) that spent the wait made the cron read main's hour in place of the stored one,
      // starting the run at the wrong hour.
      const { readStoredSchedule } = await import("./configStore");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer in time")), STORE_READ_TIMEOUT_MS);
      });
      const stored = await Promise.race([readStoredSchedule(storeUrl, deps), late]).finally(() =>
        clearTimeout(timer),
      );
      // A row that is not JSON is skipped, as the run's own copy skips it: main's file stands.
      if (stored !== null && parseJson(stored, (value) => value) !== null) return stored;
    } catch (error) {
      deps.log?.(`config store unreachable, reading main: ${describeError(error, [storeUrl])}`);
    }
  }
  return github.readFile("config/schedule.json", "main");
}

/** Vercel asks for at least 16 characters; anything shorter is treated as not configured. */
export const MIN_CRON_SECRET_CHARS = 16;

const HOUR_MS = 3_600_000;

/**
 * True in the scheduled hour and the GENERATE_AHEAD_HOURS before it: a run starts ahead, generates, and publishes
 * at the scheduled time (D193; the engine's gate holds the commit). Hour 0 has no hour before it
 * on the same date, so it starts in its own hour.
 */
function inScheduleHour(at: Date, zone: string, hour: number): boolean {
  const local = zonedHour(at, zone);
  return local <= hour && local >= Math.max(0, hour - GENERATE_AHEAD_HOURS);
}

/**
 * Which of the schedule's hours this is, on the schedule's clock: the daily one first, then the
 * weekly one. Vercel calls once in each UTC hour, anywhere in it, so the call counts when its UTC
 * hour overlaps the schedule's hour. In a whole-hour zone that is the hour itself; in a half-hour
 * zone (India) both UTC hours that overlap it count, so no call can miss it, and the gate keeps the
 * second from running again.
 */
export function slotAt(schedule: ScheduleFile, now: Date): "daily" | "weekly" | null {
  const zone = scheduleZone(schedule.timezone);
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const ends = [new Date(start), new Date(start + HOUR_MS - 1)];
  if (ends.some((at) => inScheduleHour(at, zone, schedule.hour))) return "daily";
  const { weekly } = schedule;
  const inWeekly = (at: Date) =>
    weekday(zonedDate(at, zone)) === weekly.day && inScheduleHour(at, zone, weekly.hour);
  return weekly.enabled && ends.some(inWeekly) ? "weekly" : null;
}

/** The minute of the hour run.yml's fallback entries fire at (`13 <hour> * * *`). */
const FALLBACK_MINUTE = 13;

/**
 * The Stockholm hour for RUN_CRON, run.yml's fallback: the hour whose 13th minute, Stockholm time,
 * falls inside `hour` in `zone` today (New York 07:00 is 13:00 in Stockholm for most of the year,
 * 12:00 in the weeks the two clock changes do not coincide). The workflow's schedule entries are
 * in Stockholm time, so this is exact only until either zone changes its clock; the cron route
 * above reads the zone itself and is exact all year.
 */
export function fallbackCronHour(hour: number, zone: string, now: Date): number {
  const date = zonedDate(now, zone);
  // Every listed zone is a whole or half hour from UTC, so stepping UTC hours at minute 13 visits
  // each local hour once; start well before the local midnight and stop two days on.
  const start = Date.parse(`${date}T00:${FALLBACK_MINUTE}:00Z`) - 15 * HOUR_MS;
  for (let step = 0; step < 72; step += 1) {
    const at = new Date(start + step * HOUR_MS);
    if (zonedDate(at, zone) >= date && zonedHour(at, zone) === hour) return stockholmHour(at);
  }
  return hour;
}

/** Compares digests, so the time taken says nothing about the secret, even its length. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The file's JSON checked against its schema, or null when there is no file or it does not parse. */
function parseJson<T>(text: string | null, parse: (value: unknown) => T | null): T | null {
  if (text === null) return null;
  try {
    return parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function handleCron(
  authorization: string | null,
  deps: CronDeps,
): Promise<ApiResult<CronBody>> {
  const secret = deps.env.CRON_SECRET?.trim();
  const config = readServerConfig(deps.env);
  if (!secret || secret.length < MIN_CRON_SECRET_CHARS || !config) {
    deps.log?.("not configured: CRON_SECRET or the GitHub settings are missing");
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!authorization || !sameSecret(authorization, `Bearer ${secret}`)) {
    return { status: 401, body: { error: "unauthorized" } };
  }

  const now = deps.now();
  const github = createGitHubClient(config, deps.fetch);
  try {
    const scheduleText = await readSchedule(deps, github);
    const schedule =
      scheduleText === null
        ? DEFAULT_SCHEDULE
        : parseJson(scheduleText, (value) => ScheduleFile.safeParse(value).data ?? null);
    if (!schedule) {
      // The run would stop on the same file, so there is nothing to start.
      deps.log?.("config/schedule.json does not parse; nothing dispatched");
      return { status: 200, body: { dispatched: false, reason: "the schedule does not parse" } };
    }
    const slot = slotAt(schedule, now);
    if (!slot) {
      return { status: 200, body: { dispatched: false, reason: "not the schedule's hour" } };
    }

    // A record that does not parse counts as none: the workflow's own gate reads the same file
    // and stops with the reason.
    const lastRun =
      parseJson(
        await github.readFile("state/last-run.json", "main"),
        (value) => LastRunFile.safeParse(value).data ?? null,
      ) ?? EMPTY_LAST_RUN;
    const decision = decideRun({
      now,
      mode: "scheduled",
      lastRun,
      force: false,
      cadenceDays: schedule.cadence_days,
      weekly: schedule.weekly,
      zone: scheduleZone(schedule.timezone),
    });
    // The weekly slot's own hour starts only the weekly pass. Its day has no briefing at all (the
    // gate gives the day to the weekly podcast), so the daily hour that day starts nothing.
    if (slot === "weekly" && !decision.runWeekly) {
      return { status: 200, body: { dispatched: false, reason: "the weekly pass has run today" } };
    }
    if (!decision.due && !decision.runWeekly) {
      return { status: 200, body: { dispatched: false, reason: decision.reason } };
    }

    const runId = await github.dispatch({ mode: "scheduled" });
    deps.log?.(`dispatched run.yml at the ${slot} hour: ${decision.reason}`);
    return { status: 200, body: { dispatched: true, run_id: runId, reason: decision.reason } };
  } catch (error) {
    deps.log?.(`GitHub failed: ${describeError(error, [...secretsOf(config), secret])}`);
    return { status: 502, body: { error: "github_failed" } };
  }
}
