import type { Digest } from "@singularity/core";
import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "./github";
import { type HealthInput, healthBody } from "./health";

const NOW = new Date("2026-10-27T12:00:00Z");

/** The fields the Health page reads off a briefing. */
const digest = (id: string, from: string, to: string, generated: string): Digest =>
  ({
    id,
    date: id.slice(0, 10),
    kind: id.endsWith("weekly") ? "weekly" : "regular",
    verified: true,
    generated_at: generated,
    window: { from, to },
    audio: null,
    items: [],
  }) as unknown as Digest;

const input = (over: Partial<HealthInput>): HealthInput => ({
  lastRun: null,
  schedule: null,
  digests: [],
  sourceHealth: null,
  stored: true,
  vitals: [],
  faults: null,
  jobs: {},
  ...over,
});

const rowOf = (body: ReturnType<typeof healthBody>, id: string) =>
  body.rows.find((row) => row.id === id);

describe("healthBody", () => {
  // A run started ahead of its slot records `at` when it published (D193): the ledger and the run
  // record read 96 minutes for the 2026-10-27 briefing that took 3.
  it("times a briefing from its run's start to the end of generation, never to its publish", () => {
    const body = healthBody(
      input({
        lastRun: {
          version: 1,
          regular: {
            at: "2026-10-27T05:57:00.089Z",
            outcome: "published",
            items: 8,
            digest_id: "2026-10-27",
            generated_at: "2026-10-27T04:23:31.433Z",
          },
        },
        digests: [
          digest(
            "2026-10-27",
            "2026-10-25T08:47:38Z",
            "2026-10-27T04:20:39Z",
            "2026-10-27T04:23:39Z",
          ),
        ],
      }),
      NOW,
    );
    expect(rowOf(body, "time_daily")?.value).toBe("3.0 min");
    expect(body.tiles.briefing_time).toBe("3.0 min");
  });

  // The page and `singularity health` must not disagree: a p75 past "needs improvement" warns, and
  // a p75 of a handful of visits is shown but never judged (`field_unmeasured`).
  it("judges field speed by the daily check's lines and leaves a thin sample unjudged", () => {
    const body = healthBody(
      input({
        vitals: [
          { metric: "lcp", device: "mobile", samples: 40, p75: 2600 },
          { metric: "lcp", device: "desktop", samples: 3, p75: 9000 },
        ],
      }),
      NOW,
    );
    expect(rowOf(body, "lcp.mobile")).toMatchObject({ value: "2.6 s", tone: "warn" });
    expect(rowOf(body, "lcp.desktop")?.tone).toBe("none");
    expect(body.attention.count).toBe(1);
  });

  // run.yml ticks every hour and skips outside its slot: some 160 skipped runs a week must not read
  // as passes, nor hide the one that failed. One workflow's read failing must not read as quiet.
  it("counts only the workflow runs that did work", () => {
    const run = (conclusion: string, at: string): WorkflowRun => ({
      id: Date.parse(at),
      event: "schedule",
      path: ".github/workflows/run.yml",
      status: "completed",
      conclusion,
      title: "run",
      createdAt: at,
      startedAt: at,
      updatedAt: at,
      repositoryFullName: "o/r",
    });
    const skipped = Array.from({ length: 160 }, (_, hour) =>
      run("skipped", new Date(NOW.getTime() - (hour + 1) * 3_600_000).toISOString()),
    );
    const body = healthBody(
      input({
        jobs: {
          "run.yml": [
            run("success", "2026-10-27T05:20:00Z"),
            ...skipped,
            run("failure", "2026-10-25T05:20:00Z"),
          ],
        },
      }),
      NOW,
    );
    expect(rowOf(body, "job_run")).toMatchObject({ value: "1 failed", tone: "warn" });
    // A workflow GitHub did not list is unavailable, never "No runs".
    expect(rowOf(body, "job_podcast")).toMatchObject({ value: "Unavailable", tone: "none" });
    expect(rowOf(body, "job_run")?.detail).toMatch(/^2 runs this week/);
  });
});
