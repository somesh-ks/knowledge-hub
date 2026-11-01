import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LastRunFile } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../src/run/errors.js";
import { gateStage, parseSince } from "../src/run/gate.js";
import { runPipeline } from "../src/run/pipeline.js";
import { markStage, PassState, Plan, readPassState, readPlan } from "../src/run/plan.js";
import { DEFAULT_RUN_OPTIONS, type RunDeps, type RunOptions } from "../src/run/types.js";
import { captureLog } from "./write-fakes.js";

const WED = new Date("2026-10-07T05:13:00Z");
const SUN = new Date("2026-10-11T05:13:00Z");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-gate-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function deps(now: Date): RunDeps {
  const unused = (): never => {
    throw new Error("the gate must not use this");
  };
  return {
    root,
    now: () => now,
    log: captureLog().log,
    secrets: [],
    fetch: { http: { fetchText: unused, getJson: unused, postJson: unused } },
    runtime: unused,
    pickCover: unused,
    git: unused,
  };
}

const opts = (overrides: Partial<RunOptions> = {}): RunOptions => ({
  ...DEFAULT_RUN_OPTIONS,
  ...overrides,
});

async function put(rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content, "utf8");
}

async function lastRun(file: Omit<LastRunFile, "version">): Promise<void> {
  await put("state/last-run.json", JSON.stringify({ version: 1, ...file }));
}

const record = (
  at: string,
  outcome: "published" | "nothing" | "failed" | "gated" = "published",
) => ({
  at,
  outcome,
  items: outcome === "published" ? 8 : 0,
});

async function gate(now: Date, overrides: Partial<RunOptions> = {}) {
  return gateStage(deps(now), opts(overrides));
}

describe("gate: scheduled mode", () => {
  it("is due when no regular digest has run yet", async () => {
    const report = await gate(WED);
    expect(report).toMatchObject({
      due: true,
      mode: "scheduled",
      dry_run: false,
      reason: "no regular digest has run yet",
      passes: [{ id: "2026-10-07", kind: "regular" }],
    });
  });

  it("is not due the day after, and says when it will be", async () => {
    await lastRun({ regular: record("2026-10-06T05:13:00Z") });
    const report = await gate(WED);
    expect(report).toMatchObject({ due: false, passes: [] });
    expect(report.reason).toContain("2026-10-06");
    expect(report.reason).toContain("1 day(s)");
  });
});

describe("gate: on-demand and weekly modes", () => {
  it("on-demand ignores the gate and plans an on-demand digest", async () => {
    await lastRun({ regular: record("2026-10-07T01:00:00Z") });
    const report = await gate(WED, { mode: "on-demand" });
    expect(report).toMatchObject({
      due: true,
      mode: "on-demand",
      passes: [{ id: "2026-10-07", kind: "on-demand" }],
    });
  });

  it("allocates -2 and -3 when the date's digests already exist", async () => {
    await put("Digests/2026/10/2026-10-07.md", "x");
    expect((await gate(WED, { mode: "on-demand" })).passes[0]?.id).toBe("2026-10-07-2");
    await put("Digests/2026/10/2026-10-07-2.md", "x");
    expect((await gate(WED, { mode: "on-demand" })).passes[0]?.id).toBe("2026-10-07-3");
  });

  it("gives a regular digest the next suffix after an on-demand one the same day", async () => {
    await put("Digests/2026/10/2026-10-07.md", "x");
    const report = await gate(WED, { force: true });
    expect(report.passes[0]).toMatchObject({ id: "2026-10-07-2", kind: "regular" });
  });

  it("weekly mode plans the weekly pass alone, on any day, and counts as due", async () => {
    await lastRun({ regular: record("2026-10-07T01:00:00Z") });
    const report = await gate(WED, { mode: "weekly" });
    expect(report).toMatchObject({
      due: true,
      mode: "weekly",
      passes: [{ id: "2026-10-07-weekly", kind: "weekly" }],
    });
  });

  it("weekly mode takes a numeric suffix when the weekly id exists", async () => {
    await put("Digests/2026/10/2026-10-07-weekly.md", "x");
    expect((await gate(WED, { mode: "weekly" })).passes[0]?.id).toBe("2026-10-07-2");
  });
});

describe("gate: the Sunday weekly pass", () => {
  it("follows the weekly day and hour in config/schedule.json", async () => {
    await put(
      "config/schedule.json",
      JSON.stringify({
        version: 1,
        hour: 7,
        cadence_days: 2,
        skip_topics: [],
        weekly: { day: 3, hour: 18 },
      }),
    );
    await lastRun({ regular: record("2026-10-06T05:13:00Z") });
    // Wednesday 07:13: the daily slot, before the weekly hour.
    expect((await gate(WED)).passes.map((pass) => pass.kind)).toEqual([]);
    // Wednesday 18:13 Stockholm (16:13Z): the weekly slot; the daily cadence is not due.
    const evening = await gate(new Date("2026-10-07T16:13:00Z"));
    expect(evening.passes).toMatchObject([{ id: "2026-10-07-weekly", kind: "weekly" }]);
    // Sunday no longer runs it.
    await lastRun({ regular: record("2026-10-10T05:13:00Z") });
    expect((await gate(SUN)).passes).toEqual([]);
  });

  it("does not run the weekly pass when it is switched off, but weekly mode still does", async () => {
    await put(
      "config/schedule.json",
      JSON.stringify({
        version: 1,
        hour: 7,
        cadence_days: 2,
        skip_topics: [],
        weekly: { enabled: false },
      }),
    );
    await lastRun({ regular: record("2026-10-10T05:13:00Z") });
    expect((await gate(SUN)).passes).toEqual([]);
    expect((await gate(SUN, { mode: "weekly" })).passes).toMatchObject([{ kind: "weekly" }]);
  });
});

describe("gate: fetch windows", () => {
  it("starts at the last fetch of any kind", async () => {
    await lastRun({
      regular: record("2026-10-03T05:13:00Z"),
      last_fetch_at: "2026-10-06T06:00:00Z",
    });
    const report = await gate(WED);
    expect(report.passes[0]?.window).toEqual({
      from: "2026-10-06T06:00:00.000Z",
      to: WED.toISOString(),
    });
  });

  // The 2026-10-31 daily fetched six hours because the evening's on-demand briefing had moved
  // the shared window start, and the thin pool published nothing.
  it("starts the regular digest where its own last window ended, whatever ran since", async () => {
    await lastRun({
      regular: { ...record("2026-10-05T06:00:00Z"), fetched_through: "2026-10-05T05:13:00Z" },
      on_demand: record("2026-10-06T22:13:00Z"),
      last_fetch_at: "2026-10-06T22:13:00Z",
    });
    const report = await gate(WED);
    expect(report.passes[0]?.window.from).toBe("2026-10-05T05:13:00.000Z");
  });

  it("starts every pass at --since when given", async () => {
    await lastRun({ regular: record("2026-10-09T05:13:00Z") });
    const report = await gate(SUN, { since: "2026-10-01", force: true });
    expect(report.passes.map((pass) => pass.window.from)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("rejects a --since that is not a date or lies in the future", async () => {
    await expect(gate(WED, { since: "last tuesday" })).rejects.toBeInstanceOf(UsageError);
    await expect(gate(WED, { since: "2026-12-01" })).rejects.toBeInstanceOf(UsageError);
    expect(parseSince("2026-10-06T10:00:00Z", WED).toISOString()).toBe("2026-10-06T10:00:00.000Z");
  });

  it("turns a bad --since into a usage exit code through the pipeline", async () => {
    const result = await runPipeline(deps(WED), opts({ stage: "gate", since: "nonsense" }));
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({ outcome: "failed", stage: "gate" });
  });
});

describe("gate: the plan file", () => {
  it("records mode, dry run, passes and the date for later stages", async () => {
    await gate(WED, { dryRun: true, mode: "on-demand" });
    const plan = Plan.parse(JSON.parse(await readFile(join(root, ".cache/run/plan.json"), "utf8")));
    expect(plan).toMatchObject({
      version: 1,
      mode: "on-demand",
      dry_run: true,
      date: "2026-10-07",
      created_at: WED.toISOString(),
      source: "gate",
      passes: [{ id: "2026-10-07", kind: "on-demand" }],
    });
  });

  it("is written with no passes when nothing is due, so the commit stage can say gated", async () => {
    await lastRun({ regular: record("2026-10-06T05:13:00Z") });
    await gate(WED);
    expect((await readPlan(root))?.passes).toEqual([]);
  });

  it("prints exactly the fields the workflow reads", async () => {
    const report = await gate(WED);
    expect(Object.keys(report).sort()).toEqual(["dry_run", "due", "mode", "passes", "reason"]);
    expect(Object.keys(report.passes[0] ?? {}).sort()).toEqual(["id", "kind", "window"]);
  });

  it("starts every planned pass with no stage done, even when the id was planned before", async () => {
    await gate(WED);
    const plan = await readPlan(root);
    const pass = plan?.passes[0];
    if (!pass) throw new Error("expected a pass");
    await markStage(root, pass, "fetch", { at: WED.toISOString() });
    expect((await readPassState(root, pass)).fetch).toBeDefined();
    await gate(WED);
    expect(PassState.parse(await readPassState(root, pass)).fetch).toBeUndefined();
  });

  it("fails the gate stage when state/last-run.json is corrupt", async () => {
    await put("state/last-run.json", "{ not json");
    const result = await runPipeline(deps(WED), opts({ stage: "gate" }));
    expect(result.code).toBe(1);
    expect(result.report).toMatchObject({ outcome: "failed", stage: "gate" });
  });
});
