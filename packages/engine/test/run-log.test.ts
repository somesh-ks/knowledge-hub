import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadEnv } from "@singularity/core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLogRunCommand } from "../src/commands/logRun.js";
import { priceSpend } from "../src/cost/ledger.js";
import { buildEpisodeRunRecord } from "../src/podcast/runLog.js";
import { type Plan, writePlan } from "../src/run/plan.js";
import { SpendTracker, spendDelta } from "../src/run/spend.js";
import { addStageCost, addStageTime, noteStageFailure } from "../src/run/stageClock.js";
import type { SqlClient } from "../src/store/configPaths.js";
import { readStageTimings } from "../src/store/runsStore.js";
import { captureLog } from "./write-fakes.js";

vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** An in-process Postgres standing in for Neon, with no table made in advance. */
function neon(): { sql: SqlClient; db: PGlite } {
  const db = new PGlite();
  open.push(db);
  return {
    db,
    sql: {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    },
  };
}

const PLAN: Plan = {
  version: 1,
  mode: "scheduled",
  dry_run: false,
  created_at: "2026-10-29T05:13:00.000Z",
  date: "2026-10-29",
  reason: "due",
  passes: [
    {
      id: "2026-10-29",
      kind: "regular",
      window: { from: "2026-10-27T05:00:00.000Z", to: "2026-10-29T05:00:00.000Z" },
    },
  ],
  source: "gate",
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "run-log-"));
  await mkdir(join(root, "config"), { recursive: true });
  await cp(join(process.cwd(), "config/prices.json"), join(root, "config/prices.json"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** What the stages of a run leave on the runner, as the pipeline writes them. */
async function leaveRun(plan: Plan, failure?: { stage: string; reason: string }): Promise<void> {
  await writePlan(root, plan);
  const tracker = new SpendTracker();
  await tracker.resume(root, plan.created_at);
  const before = tracker.snapshot();
  tracker.meter.addUnits("anthropic", "claude-sonnet-5-5", "input_tokens", 1_000_000);
  tracker.meter.add("jev", 450);
  await addStageTime(root, plan.created_at, "judge", 7_000);
  await addStageTime(root, plan.created_at, "write", 77_000);
  await addStageCost(
    root,
    plan.created_at,
    "write",
    await priceSpend(root, spendDelta(before, tracker.snapshot())),
  );
  await tracker.save(root);
  if (failure) await noteStageFailure(root, plan.created_at, failure.stage, failure.reason);
}

async function logRun(sql: SqlClient, ...args: string[]) {
  const { log, lines } = captureLog();
  const command = makeLogRunCommand(async () => sql);
  const code = await command(args, {
    root,
    env: loadEnv({ DATABASE_URL: "postgres://user:secret-password@host/db" }),
    log,
    json: false,
    now: () => new Date("2026-10-29T06:57:00.000Z"),
  });
  return { code, lines };
}

describe("the run log", () => {
  // The bugs it prevents: a failed or dry run leaving no trace (the committed metrics and the ledger
  // hold only runs that published, so the 28 Oct run that aired nothing for $1.18 had no stage times),
  // a stage's cost lost in the run's total, the wait for the publish time counted as generation, and
  // a second log of the same run writing a second row.
  it("writes a failed dry run with each stage's time and cost, and one row however often it is logged", async () => {
    const { sql, db } = neon();
    await leaveRun(
      { ...PLAN, dry_run: true },
      { stage: "validate", reason: "refill invalid_output" },
    );

    expect((await logRun(sql, "--result", "failure")).code).toBe(0);
    expect((await logRun(sql, "--result", "failure")).code).toBe(0);

    const runs = (await db.query<Record<string, unknown>>("select * from pipeline_runs")).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      run_id: PLAN.created_at,
      kind: "daily",
      dry_run: true,
      outcome: "failed",
      failure_stage: "validate",
      work_ms: 84_000,
      podcasts: ["2026-10-29"],
    });
    // 1M Sonnet input tokens at $3: all of it came from the write stage.
    const stages = (
      await db.query<{ stage: string; ms: number; usd: number }>(
        "select stage, ms, usd from pipeline_stages order by stage",
      )
    ).rows;
    expect(stages.map((stage) => [stage.stage, stage.ms])).toEqual([
      ["judge", 7_000],
      ["write", 77_000],
    ]);
    expect(stages[1]?.usd).toBeCloseTo(3, 4);
    expect(stages[0]?.usd).toBe(0);
    expect(Number(runs[0]?.usd)).toBeCloseTo(stages[1]?.usd ?? 0, 4);
  });

  it("keeps a run that waited for its slot apart from the time it took to make", async () => {
    const { sql, db } = neon();
    await leaveRun(PLAN);
    await logRun(sql, "--result", "success", "--outcome", "published");
    const [row] = (
      await db.query<Record<string, unknown>>(
        "select outcome, work_ms, total_ms from pipeline_runs",
      )
    ).rows;
    // Started 05:13, logged 06:57: 104 minutes in all, 84 seconds of work.
    expect(row).toMatchObject({ outcome: "published", work_ms: 84_000, total_ms: 104 * 60_000 });
  });

  // The timing a Health row would show: a dry run is a test of the pipeline and a failed or cancelled run stops
  // early, so none may drag a stage's median.
  it("reads a stage's median from finished runs only", async () => {
    const { sql } = neon();
    await leaveRun(PLAN);
    await logRun(sql, "--result", "success", "--outcome", "published");
    for (const [created, args] of [
      ["2026-10-28T05:13:00.000Z", ["--result", "failure"]],
      ["2026-10-26T05:13:00.000Z", ["--result", "cancelled"]],
      ["2026-10-27T05:13:00.000Z", ["--result", "success", "--outcome", "published"]],
    ] as const) {
      await leaveRun(
        { ...PLAN, created_at: created, dry_run: created.startsWith("2026-10-27") },
        undefined,
      );
      await logRun(sql, ...args);
    }
    const timings = await readStageTimings(sql, Date.parse("2026-10-30T00:00:00Z"));
    expect(timings.find((each) => each.stage === "write")).toMatchObject({
      kind: "daily",
      runs: 1,
      p50_ms: 77_000,
    });
  });

  it("never fails the run it measures", async () => {
    const down: SqlClient = {
      query: async () => {
        throw new Error("connect ECONNREFUSED secret-password");
      },
    };
    await leaveRun(PLAN);
    const failed = await logRun(down, "--result", "success", "--outcome", "nothing");
    expect(failed.code).toBe(0);
    expect(JSON.stringify(failed.lines)).not.toContain("secret-password");
    // No plan at all (the job died before the gate): nothing to say, and still no failure.
    await rm(join(root, ".cache"), { recursive: true, force: true });
    expect((await logRun(neon().sql, "--result", "failure")).code).toBe(0);
    expect((await logRun(neon().sql, "--result", "maybe")).code).toBe(2);
  });

  // The Catch up that failed ("2 of 7 podcast.yml runs failed, the cause unnamed") left no record
  // but a red run: its stage times, the stage it stopped in and what the writer had cost by then.
  it("records a Catch up from its stage artifacts, failed or not, and never a delete", async () => {
    const artifacts = join(root, "stages");
    await mkdir(artifacts);
    await mkdir(join(root, "state"));
    await writeFile(join(artifacts, "select.json"), JSON.stringify({ id: "ep-20261029-1405" }));
    await writeFile(
      join(artifacts, "timings.json"),
      JSON.stringify({ select: 4_000, cover: 1_000, script: 120_000 }),
    );
    await writeFile(
      join(artifacts, "failure.json"),
      JSON.stringify({ failed_stage: "publish", kept: ["select"], reason: "push rejected" }),
    );
    await writeFile(
      join(root, "state/costs-2026-10.json"),
      JSON.stringify({
        version: 1,
        records: [
          {
            id: "w",
            at: "2026-10-29T14:06:00Z",
            run_id: "ep-20261029-1405",
            kind: "on_demand",
            timezone: "Europe/Stockholm",
            user: "owner",
            scope: "user",
            stage: "write",
            provider: "anthropic",
            product: "claude-sonnet-5-5",
            units: { input_tokens: 1 },
            usd: 0.4,
          },
        ],
      }),
    );
    const input = {
      root,
      artifacts,
      request: JSON.stringify({ topic_ids: ["ai"], length_minutes: 5 }),
      now: new Date("2026-10-29T14:09:00Z"),
      startedAt: "2026-10-29T14:05:00Z",
      githubRunId: "99",
    };
    const failed = await buildEpisodeRunRecord({ ...input, result: "failure" });
    expect(failed).toMatchObject({
      run_id: "ep-20261029-1405",
      workflow: "podcast",
      kind: "catch_up",
      outcome: "failed",
      podcasts: ["ep-20261029-1405"],
      work_ms: 125_000,
      total_ms: 240_000,
      usd: 0.4,
      failure: { stage: "publish", reason: "push rejected" },
    });
    expect(failed?.stages.find((stage) => stage.stage === "script")?.usd).toBe(0.4);
    // A retry restores the first attempt's stage times: the run cannot have taken less than its work.
    const retried = await buildEpisodeRunRecord({
      ...input,
      startedAt: "2026-10-29T14:08:30Z",
      result: "success",
    });
    expect(retried).toMatchObject({
      work_ms: 125_000,
      total_ms: 125_000,
      started_at: "2026-10-29T14:06:55.000Z",
    });
    const regenerated = await buildEpisodeRunRecord({
      ...input,
      request: JSON.stringify({ action: "regenerate", id: "ep-20261028-0900" }),
      result: "success",
    });
    expect(regenerated).toMatchObject({
      mode: "regenerate",
      replaces: "ep-20261028-0900",
      outcome: "published",
      failure: null,
    });
    const deleted = JSON.stringify({ action: "delete", id: "ep-20261028-0900" });
    expect(
      await buildEpisodeRunRecord({ ...input, request: deleted, result: "success" }),
    ).toBeNull();
  });
});
