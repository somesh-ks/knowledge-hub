import { DEFAULT_SCHEDULE } from "@singularity/core";
import { describe, expect, it, vi } from "vitest";
import { createFakeGitHub, REPO } from "../testing/fakeGitHub";
import {
  fallbackCronHour,
  handleCron,
  MIN_CRON_SECRET_CHARS,
  STORE_READ_TIMEOUT_MS,
  slotAt,
} from "./cron";

const TOKEN = "github_pat_secret_value_123456";
const SECRET = "cron-secret-of-enough-length";
const env = {
  GITHUB_SINGULARITY_TOKEN: TOKEN,
  GITHUB_REPOSITORY: REPO,
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

// The route counted in Stockholm whatever zone was chosen, so New York at 07:00 ran at 07:00 in Stockholm (D89).
describe("the schedule's hours in its own time zone", () => {
  const zoned = (timezone: string, weeklyHour = 7) => ({
    ...DEFAULT_SCHEDULE,
    timezone,
    weekly: { ...DEFAULT_SCHEDULE.weekly, hour: weeklyHour },
  });

  it("reads the daily hour and the weekly slot on New York's clock", () => {
    const newYork = zoned("America/New_York", 18);
    expect(slotAt(newYork, new Date("2026-10-11T11:10:00Z"))).toBe("daily");
    // 07:30 in Stockholm is 01:30 in New York.
    expect(slotAt(newYork, SUNDAY_0730)).toBeNull();
    // 18:10 on Sunday in New York is already Monday in Stockholm.
    expect(slotAt(newYork, new Date("2026-10-11T22:10:00Z"))).toBe("weekly");
  });

  it.each([
    ["the UTC hour that ends inside 07:00 to 08:00 in India", "2026-10-12T01:10:00Z", "daily"],
    ["the UTC hour that starts inside it", "2026-10-12T02:50:00Z", "daily"],
    ["the hour before, where a run starts ahead", "2026-10-12T00:50:00Z", "daily"],
    ["two hours before", "2026-10-11T23:50:00Z", null],
    ["the hour after", "2026-10-12T03:10:00Z", null],
  ])("counts a call in %s", (_name, at, slot) => {
    expect(slotAt(zoned("Asia/Kolkata"), new Date(at))).toBe(slot);
  });
});

// RUN_CRON is in Stockholm time; a New York 07:00 written as 07 ran six hours early.
describe("the fallback cron's Stockholm hour", () => {
  it.each([
    ["Stockholm", 7, "Europe/Stockholm", "2026-10-12T12:00:00Z", 7],
    ["New York in summer time", 7, "America/New_York", "2026-10-12T12:00:00Z", 13],
    [
      "New York after Europe's change, before America's",
      7,
      "America/New_York",
      "2026-10-28T12:00:00Z",
      12,
    ],
    ["New York in winter time", 7, "America/New_York", "2026-11-05T12:00:00Z", 13],
    [
      "New York after America's March change, before Europe's",
      7,
      "America/New_York",
      "2026-03-15T12:00:00Z",
      12,
    ],
    [
      "India, whose 07:13 Stockholm misses the half hour",
      7,
      "Asia/Kolkata",
      "2026-10-12T12:00:00Z",
      4,
    ],
    ["Auckland, a day ahead", 7, "Pacific/Auckland", "2026-10-12T12:00:00Z", 20],
    ["UTC", 7, "UTC", "2026-12-01T12:00:00Z", 8],
  ])("is right for %s", (_name, hour, zone, now, expected) => {
    expect(fallbackCronHour(hour, zone, new Date(now))).toBe(expected);
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

  // The bug (D149, review round 2): with the config store on, an hour changed in the app is in the
  // database at once and on main only after the next run, so the cron kept starting the old hour.
  it("with the config store on, starts at the stored hour, and at main's when the store is down", async () => {
    const { github } = setup({ lastRun: lastRun("2026-10-08T11:58:00.000Z") });
    const stored = JSON.stringify({ ...DEFAULT_SCHEDULE, hour: 9 });
    const call = (at: string, up: boolean) =>
      handleCron(BEARER, {
        env: { ...env, DATABASE_URL: "postgres://fake", SINGULARITY_CONFIG_STORE: "postgres" },
        fetch: github.fetch,
        now: () => new Date(at),
        connectConfigStore: async () => ({
          query: async () => {
            if (!up) throw new Error("connect ECONNREFUSED");
            return [{ path: "config/schedule.json", content: stored, version: 1 }];
          },
        }),
      });
    // Saturday 07:30 and 09:30 in Stockholm.
    expect((await call("2026-10-10T05:30:00Z", true)).body).toMatchObject({ dispatched: false });
    expect((await call("2026-10-10T07:30:00Z", true)).body).toMatchObject({ dispatched: true });
    expect((await call("2026-10-10T05:30:00Z", false)).body).toMatchObject({ dispatched: true });
  });

  // The bug: a store that never answers held the call until Vercel killed it, so the hour's run was
  // never started, where main's schedule would have started it.
  it("with the config store hanging, starts at main's hour once it has waited long enough", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { github } = setup({ lastRun: lastRun("2026-10-08T11:58:00.000Z") });
      const result = handleCron(BEARER, {
        env: { ...env, DATABASE_URL: "postgres://fake", SINGULARITY_CONFIG_STORE: "postgres" },
        fetch: github.fetch,
        now: () => new Date("2026-10-10T05:30:00Z"),
        connectConfigStore: async () => ({ query: () => new Promise(() => {}) }),
      });
      await vi.advanceTimersByTimeAsync(STORE_READ_TIMEOUT_MS);
      expect((await result).body).toMatchObject({ dispatched: true });
    } finally {
      vi.useRealTimers();
    }
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
