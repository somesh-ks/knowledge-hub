import { createHash, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_SCHEDULE,
  EMPTY_LAST_RUN,
  LastRunFile,
  ScheduleFile,
  stockholmDate,
  stockholmHour,
  weekday,
} from "@dispatch/core";
import { decideRun } from "@dispatch/engine/gate";
import { readServerConfig, type ServerEnv, secretsOf } from "./config";
import { createGitHubClient, type FetchLike } from "./github";
import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * GET /api/cron/run: what starts the scheduled briefing on time (D61). Since late August 2026
 * GitHub has started this repository's scheduled runs hours late (the 07:13 entry ran between 13:11
 * and 14:02), so Vercel Cron calls this route once in every UTC hour (vercel.json; on the Hobby plan
 * a call lands anywhere in its hour). Each call reads config/schedule.json on main. In the
 * schedule's own hour, Stockholm time, which is the daily hour or the weekly slot's hour on its day,
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
}

/** Vercel asks for at least 16 characters; anything shorter is treated as not configured. */
export const MIN_CRON_SECRET_CHARS = 16;

/** Which of the schedule's hours this is, Stockholm time: the daily one first, then the weekly one. */
export function slotAt(schedule: ScheduleFile, now: Date): "daily" | "weekly" | null {
  const hour = stockholmHour(now);
  if (hour === schedule.hour) return "daily";
  const { weekly } = schedule;
  const weeklyDay = weekday(stockholmDate(now)) === weekly.day;
  return weekly.enabled && weeklyDay && weekly.hour === hour ? "weekly" : null;
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
    const scheduleText = await github.readFile("config/schedule.json", "main");
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
    });
    // The weekly slot's own hour starts only the weekly pass; a briefing due that day waits for its
    // own hour, unless the weekly pass takes it along.
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
