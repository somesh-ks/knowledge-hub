import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../context.js";
import type { SqlClient } from "../store/configPaths.js";
import {
  addPushWatch,
  isPushEndpoint,
  MAX_WATCHES_PER_RUN,
  setPushDevice,
  WATCH_LIFETIME_MS,
} from "../store/pushStore.js";
import { RUNS_SCHEMA_SQL } from "../store/runsStore.js";
import { makePushCommand, messageFor, type PushSender } from "./push.js";

// An in-process Postgres takes over 5 s to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

function store(): SqlClient {
  const db = new PGlite();
  open.push(db);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

const NOW = Date.parse("2026-10-31T12:00:00Z");
const EP = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const watch = (run: string, n: number, kind: "catch_up" | "regenerate" = "catch_up") => ({
  run_id: run,
  endpoint: EP(n),
  p256dh: "p",
  auth: "a",
  kind,
});

async function logRun(sql: SqlClient, githubRunId: string, outcome: string, podcast: string) {
  for (const statement of RUNS_SCHEMA_SQL) await sql.query(statement);
  await sql.query(
    `insert into pipeline_runs (run_id, workflow, kind, mode, dry_run, outcome, podcasts, started_at,
finished_at, work_ms, total_ms, usd, github_run_id)
values ($1, 'podcast', 'catch_up', 'api', false, $2, $3::text[], now(), now(), 1, 1, 0, $4)`,
    [`r-${githubRunId}-${podcast}`, outcome, [podcast], githubRunId],
  );
}

/** What `push notify` printed while `run` ran: one JSON line per call. */
async function printed(run: () => Promise<unknown>): Promise<Record<string, number>[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines.map((line) => JSON.parse(line));
}

function context(env: Record<string, string>): CommandContext {
  const lines: string[] = [];
  return {
    env,
    now: () => new Date(NOW),
    json: true,
    log: {
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
      info() {},
      debug() {},
    },
  } as unknown as CommandContext;
}

describe("push notify (D284)", () => {
  // The bug it prevents: a person is pinged for a run they did not start, twice for one run, or never
  // (a dead address kept for ever), or a third stranger's address is stored against a run.
  it("sends once per ended run, drops dead addresses, retries a failure, and sweeps the old", async () => {
    const sql = store();
    expect(await addPushWatch(sql, watch("100", 1), NOW)).toBe(true);
    expect(await addPushWatch(sql, watch("100", 2), NOW)).toBe(true);
    // The run takes at most two browsers.
    expect(MAX_WATCHES_PER_RUN).toBe(2);
    expect(await addPushWatch(sql, watch("100", 3), NOW)).toBe(false);
    // The same browser again only refreshes its keys.
    expect(await addPushWatch(sql, watch("100", 1), NOW)).toBe(true);
    await addPushWatch(sql, watch("200", 1, "regenerate"), NOW); // still running
    await addPushWatch(sql, watch("300", 4), NOW); // ended with nothing to publish
    await addPushWatch(sql, watch("400", 5), NOW - WATCH_LIFETIME_MS - 1); // too old
    await logRun(sql, "100", "published", "ep-20261031-1200");
    await logRun(sql, "300", "nothing", "2026-10-31");

    const calls: string[] = [];
    const send: PushSender = async (target, message) => {
      calls.push(`${target.endpoint} ${message.url}`);
      return target.endpoint === EP(2) ? "gone" : "sent";
    };
    const command = makePushCommand({ connect: async () => sql, send });
    const env = { DATABASE_URL: "postgres://x" };
    const [summary] = await printed(() => command(["notify"], context(env)));
    expect(calls.sort()).toEqual([`${EP(1)} /e/ep-20261031-1200`, `${EP(2)} /e/ep-20261031-1200`]);
    // Two watch rows ended, on one run: the log counts runs (M9), so it reads as one run, not two.
    expect(summary).toMatchObject({ ended: 1, claimed: 0, addressed: 0 });

    // Nothing is left for run 100, 300 or 400; run 200 still waits.
    const left = await sql.query("select run_id from push_watches order by run_id");
    expect(left.map((row) => row.run_id)).toEqual(["200"]);

    // A push service that is down leaves the watch for the next sync.
    await logRun(sql, "200", "failed", "ep-20261031-1300");
    const down = makePushCommand({ connect: async () => sql, send: async () => "failed" });
    expect(await down(["notify"], context(env))).toBe(0);
    expect((await sql.query("select 1 from push_watches")).length).toBe(1);
  });

  // The bug it prevents: the Daily announced twice (one ping per sync), sent to a device that asked
  // only for the Weekly, or a regeneration announced as if it were the new Daily; and a log that says
  // two devices were addressed when one device took both runs (M9).
  it("announces a published Daily and Weekly once, to the devices that asked, and counts each device once", async () => {
    const sql = store();
    const phone = { endpoint: EP(1), p256dh: "p", auth: "a" };
    expect(await setPushDevice(sql, { ...phone, daily: true, weekly: false }, NOW)).toBe(true);
    await setPushDevice(sql, { ...phone, endpoint: EP(2), daily: false, weekly: true }, NOW);
    await setPushDevice(sql, { ...phone, endpoint: EP(3), daily: true, weekly: true }, NOW);
    for (const statement of RUNS_SCHEMA_SQL) await sql.query(statement);
    const row = (id: string, kind: string, replaces: string | null) =>
      sql.query(
        `insert into pipeline_runs (run_id, workflow, kind, mode, replaces, dry_run, outcome, podcasts,
started_at, finished_at, work_ms, total_ms, usd)
values ($1, 'run', $2, 'api', $3, false, 'published', $4::text[], $5::timestamptz, $5::timestamptz, 1, 1, 0)`,
        [id, kind, replaces, ["2026-10-31"], new Date(NOW - 60_000).toISOString()],
      );
    await row("daily-1", "daily", null);
    await row("daily-redo", "daily", "2026-10-29");
    await row("weekly-1", "weekly", null);

    const calls: string[] = [];
    const send: PushSender = async (target, message) => {
      calls.push(`${target.endpoint} ${message.title} ${message.url}`);
      return target.endpoint === EP(1) ? "gone" : "sent";
    };
    const command = makePushCommand({ connect: async () => sql, send });
    const env = { DATABASE_URL: "postgres://x" };
    const [first] = await printed(() => command(["notify"], context(env)));
    expect(calls.sort()).toEqual([
      `${EP(1)} Your Daily is ready /d/2026-10-31`,
      `${EP(2)} Your Weekly is ready /d/2026-10-31`,
      `${EP(3)} Your Daily is ready /d/2026-10-31`,
      `${EP(3)} Your Weekly is ready /d/2026-10-31`,
    ]);
    // Two runs, and three devices although the third took both: four sends, not four devices.
    expect(first).toMatchObject({ claimed: 2, addressed: 3, sent: 3 });
    // The dead address is forgotten; a second sync says nothing more about the same runs.
    expect((await sql.query("select endpoint from push_devices order by endpoint")).length).toBe(2);
    calls.length = 0;
    const [second] = await printed(() => command(["notify"], context(env)));
    expect(calls).toEqual([]);
    expect(second).toMatchObject({ claimed: 0, addressed: 0 });
  });

  it("does nothing, and does not fail the sync, when push is not set up", async () => {
    const send = vi.fn();
    const command = makePushCommand({ send });
    expect(await command(["notify"], context({}))).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("opens the episode that was made, and takes only the browsers' own push services", () => {
    const ended = { ...watch("1", 1), outcome: "ready" as const, podcast: "ep-20261031-1200" };
    expect(messageFor(ended).url).toBe("/e/ep-20261031-1200");
    expect(messageFor({ ...ended, podcast: null }).url).toBe("/library");
    expect(isPushEndpoint(EP(1))).toBe(true);
    // A made-up address would aim the workflow at an internal host.
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
  });
});
