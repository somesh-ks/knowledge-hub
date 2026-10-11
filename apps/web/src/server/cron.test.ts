import { DEFAULT_SCHEDULE } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { createFakeGitHub, REPO } from "../testing/fakeGitHub";
import { handleCron, MIN_CRON_SECRET_CHARS, slotAt } from "./cron";

const TOKEN = "github_pat_secret_value_123456";
const SECRET = "cron-secret-of-enough-length";
const env = {
  GITHUB_DISPATCH_TOKEN: TOKEN,
  GITHUB_REPOSITORY: REPO,
  GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
  CRON_SECRET: SECRET,
};
const BEARER = `Bearer ${SECRET}`;
const DISPATCH = "POST /actions/workflows/run.yml/dispatches";

/** Sunday 11 October 2026, 07:30 in Stockholm (summer time). */
const SUNDAY_0730 = new Date("2026-10-11T05:30:00Z");

const lastRun = (regularAt: string, weeklyAt?: string) =>
  JSON.stringify({
    version: 1,
    regular: { at: regularAt, outcome: "published", digest_id: "x", items: 9 },
    ...(weeklyAt
      ? { weekly: { at: weeklyAt, outcome: "published", digest_id: "y", items: 9 } }
      : {}),
  });

function setup(files: { schedule?: string; lastRun?: string } = {}) {
  const github = createFakeGitHub();
  if (files.schedule !== undefined) {
    github.on("GET /contents/config/schedule.json", { text: files.schedule });
  }
  if (files.lastRun !== undefined)
    github.on("GET /contents/state/last-run.json", { text: files.lastRun });
  github.on(DISPATCH, { json: { workflow_run_id: 99 } });
  const logs: string[] = [];
  const run = (at: Date, authorization: string | null = BEARER, extraEnv = {}) =>
    handleCron(authorization, {
      env: { ...env, ...extraEnv },
      fetch: github.fetch,
      now: () => at,
      log: (message) => logs.push(message),
    });
  return { github, logs, run };
}

const dispatches = (github: ReturnType<typeof createFakeGitHub>) =>
  github.requests.filter((request) => request.method === "POST");

describe("which of the schedule's hours this is", () => {
  it("is the daily hour first, in Stockholm time", () => {
    expect(slotAt(DEFAULT_SCHEDULE, SUNDAY_0730)).toBe("daily");
    // 07:30 in Stockholm is 06:30 UTC once the clocks go back.
    expect(slotAt(DEFAULT_SCHEDULE, new Date("2026-10-26T06:30:00Z"))).toBe("daily");
    expect(slotAt(DEFAULT_SCHEDULE, new Date("2026-10-11T06:30:00Z"))).toBeNull();
  });

  it("is the weekly slot's own hour on its day only, while it is on", () => {
    const schedule = { ...DEFAULT_SCHEDULE, weekly: { ...DEFAULT_SCHEDULE.weekly, hour: 18 } };
    expect(slotAt(schedule, new Date("2026-10-11T16:10:00Z"))).toBe("weekly");
    expect(slotAt(schedule, new Date("2026-10-12T16:10:00Z"))).toBeNull();
    const off = { ...schedule, weekly: { ...schedule.weekly, enabled: false } };
    expect(slotAt(off, new Date("2026-10-11T16:10:00Z"))).toBeNull();
  });
});

describe("GET /api/cron/run", () => {
  it("refuses everything until a long enough secret is configured, without calling GitHub", async () => {
    const { github, run } = setup();
    expect((await run(SUNDAY_0730, BEARER, { CRON_SECRET: undefined })).status).toBe(503);
    const short = "s".repeat(MIN_CRON_SECRET_CHARS - 1);
    expect((await run(SUNDAY_0730, `Bearer ${short}`, { CRON_SECRET: short })).status).toBe(503);
    expect(github.requests).toEqual([]);
  });

  it("refuses a call without the secret, without calling GitHub", async () => {
    const { github, run } = setup();
    for (const authorization of [null, "", SECRET, `Bearer ${SECRET}x`, "Bearer wrong"]) {
      const result = await run(SUNDAY_0730, authorization);
      expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    }
    expect(github.requests).toEqual([]);
  });

  it("outside the schedule's hours reads the schedule and starts nothing", async () => {
    const { github, run } = setup();
    const result = await run(new Date("2026-10-11T09:30:00Z"));
    expect(result.body).toEqual({ dispatched: false, reason: "not the schedule's hour" });
    // No schedule file means 07:00, so the run record is never read.
    expect(github.requests.map((request) => request.path)).toEqual([
      "/contents/config/schedule.json?ref=main",
    ]);
  });

  it("at the daily hour, with a briefing due, dispatches a scheduled run", async () => {
    const { github, logs, run } = setup({ lastRun: lastRun("2026-10-08T11:58:00.000Z") });
    // Saturday, 07:30 in Stockholm.
    const result = await run(new Date("2026-10-10T05:30:00Z"));
    expect(result).toEqual({
      status: 200,
      body: {
        dispatched: true,
        run_id: 99,
        reason: "last regular digest was 2026-10-08, 2 days ago",
      },
    });
    expect(dispatches(github).map((request) => request.body)).toEqual([
      { ref: "main", inputs: { mode: "scheduled" }, return_run_details: true },
    ]);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("at the daily hour on a day nothing is due, starts nothing", async () => {
    const { github, run } = setup({
      lastRun: lastRun("2026-10-11T05:40:00.000Z", "2026-10-11T05:44:00.000Z"),
    });
    // Monday, 07:20 in Stockholm: the briefing ran yesterday, and the weekly pass is Sunday's.
    const result = await run(new Date("2026-10-12T05:20:00Z"));
    expect(result.body).toEqual({
      dispatched: false,
      reason: "last regular digest was 2026-10-11; next is due 1 day(s) from now",
    });
    expect(dispatches(github)).toEqual([]);
  });

  it("at the weekly slot's own hour, dispatches for the weekly pass alone", async () => {
    const schedule = JSON.stringify({
      version: 1,
      hour: 7,
      cadence_days: 2,
      sections: null,
      weekly: { enabled: true, day: 0, hour: 18 },
    });
    const { github, run } = setup({ schedule, lastRun: lastRun("2026-10-11T05:40:00.000Z") });
    const result = await run(new Date("2026-10-11T16:10:00Z"));
    expect(result.body).toMatchObject({ dispatched: true, run_id: 99 });
    expect(dispatches(github)).toHaveLength(1);
  });

  it("starts nothing once the weekly pass has run that day", async () => {
    const schedule = JSON.stringify({
      version: 1,
      hour: 7,
      cadence_days: 2,
      sections: null,
      weekly: { enabled: true, day: 0, hour: 18 },
    });
    const { github, run } = setup({
      schedule,
      lastRun: lastRun("2026-10-11T05:40:00.000Z", "2026-10-11T16:02:00.000Z"),
    });
    expect((await run(new Date("2026-10-11T16:30:00Z"))).body).toEqual({
      dispatched: false,
      reason: "the weekly pass has run today",
    });
    expect(dispatches(github)).toEqual([]);
  });

  it("on the weekly day, starts the weekly pass at its hour and no briefing at the daily hour", async () => {
    const schedule = JSON.stringify({
      version: 1,
      hour: 9,
      cadence_days: 2,
      sections: null,
      weekly: { enabled: true, day: 0, hour: 6 },
    });
    // The weekly pass ran at 06:10; the briefing due today gives the day to it.
    const { github, run } = setup({
      schedule,
      lastRun: lastRun("2026-10-09T07:40:00.000Z", "2026-10-11T04:10:00.000Z"),
    });
    expect((await run(new Date("2026-10-11T04:40:00Z"))).body).toEqual({
      dispatched: false,
      reason: "the weekly pass has run today",
    });
    expect((await run(new Date("2026-10-11T07:20:00Z"))).body).toEqual({
      dispatched: false,
      reason: "today is the weekly podcast's day; no briefing",
    });
    expect(dispatches(github)).toHaveLength(0);
  });

  it("starts nothing when the schedule does not parse, as the run would stop on it", async () => {
    const { github, logs, run } = setup({ schedule: "{ not json" });
    expect((await run(SUNDAY_0730)).body).toEqual({
      dispatched: false,
      reason: "the schedule does not parse",
    });
    expect(dispatches(github)).toEqual([]);
    expect(logs).toEqual(["config/schedule.json does not parse; nothing dispatched"]);
  });

  it("answers 502 when GitHub fails, and the log names neither secret", async () => {
    const { github, logs, run } = setup({ lastRun: lastRun("2026-10-09T11:58:00.000Z") });
    github.on(DISPATCH, { status: 500 });
    expect(await run(SUNDAY_0730)).toEqual({ status: 502, body: { error: "github_failed" } });
    expect(logs).toEqual(["GitHub failed: GitHubError: GitHub answered 500"]);
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});
