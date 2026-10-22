import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestRelPath, serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectHealth, type HealthFetch } from "../src/ops/health.js";
import { checkPerf, checkRunsDied } from "../src/ops/healthChecks.js";
import { makeDigest } from "./audio-fixtures.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const AUDIO = "https://x.public.blob.vercel-storage.com/audio/2026-10-20.mp3";
let root: string;

async function put(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-health-"));
  // A briefing last published eleven days ago, a weekly that failed, two fallbacks.
  await put(
    "state/last-run.json",
    JSON.stringify({
      version: 1,
      regular: {
        at: "2026-10-10T05:00:00Z",
        digest_id: "2026-10-10",
        items: 8,
        outcome: "published",
      },
      weekly: { at: "2026-10-18T05:00:00Z", items: 0, outcome: "failed" },
      spend: { at: "2026-10-18T05:00:00Z", requests: { model_fallback: 2 } },
    }),
  );
  const yesterday = makeDigest({
    id: "2026-10-19",
    date: "2026-10-19",
    generated_at: "2026-10-19T05:00:00Z",
  });
  const newest = makeDigest(
    {
      id: "2026-10-20",
      date: "2026-10-20",
      generated_at: "2026-10-20T05:00:00Z",
      audio: { url: AUDIO, duration_ms: 60_000 },
    },
    3,
  );
  // A story the writer left as a stub: it parses, and reads as nothing.
  newest.items[1] = {
    ...(newest.items[1] as (typeof newest.items)[number]),
    summary: "To follow.",
  };
  // The newest briefing airs one minute of the five the schedule sets.
  await put(
    "config/schedule.json",
    JSON.stringify({ version: 1, hour: 7, cadence_days: 2, length_minutes: 5, skip_topics: [] }),
  );
  await put(digestRelPath(yesterday.id), serializeDigestFile(yesterday));
  await put(digestRelPath(newest.id), serializeDigestFile(newest));
  await put(digestRelPath("2026-10-16"), "---\nnot: a digest\n---\n");
  await put(
    "state/costs-2026-10.json",
    JSON.stringify({
      version: 1,
      records: [
        {
          id: "r1",
          at: "2026-10-21T06:00:00Z",
          run_id: "run",
          kind: "daily",
          timezone: "Europe/Stockholm",
          user: "owner",
          scope: "shared",
          stage: "write",
          provider: "anthropic",
          product: "claude",
          units: { input_tokens: 1 },
          usd: 7.5,
        },
      ],
    }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const codes = (findings: ReadonlyArray<{ code: string; severity: string }>, severity: string) =>
  findings.filter((each) => each.severity === severity).map((each) => each.code);

describe("dispatch health", () => {
  // Each of these was an ordinary line in `dispatch status` that nobody read.
  it("faults a failed run, a missed run, missing narration, a broken digest, a short episode, a thin briefing, a stub story and a runaway spend", async () => {
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 5,
      site: null,
    });
    expect(report.ok).toBe(false);
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining([
        "run_failed",
        "run_overdue",
        "audio_missing",
        "digest_invalid",
        "episode_short",
        "cost_over_ceiling",
      ]),
    );
    expect(codes(report.findings, "warning")).toEqual(
      expect.arrayContaining(["model_fallback", "digest_thin", "story_short"]),
    );
  });

  // A deploy Vercel skipped (a wrong author on Hobby) or one that lost vercel.json looks fine to CI.
  it("faults a live site that lost its headers, serves an old briefing, cannot tell an app it changed and lost the narration file", async () => {
    const asked: string[] = [];
    const answer = (status: number, body = "", headers: Record<string, string> = {}) => ({
      status,
      headers: { get: (name: string) => headers[name] ?? null },
      text: async () => body,
    });
    const fake: HealthFetch = async (url, init) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === AUDIO) return answer(404);
      if (url.endsWith("/api/podcast")) return answer(405);
      if (url.endsWith("/latest.json")) return answer(200, '{"id":"2026-10-19"}');
      // A worker the browser may keep for a day, so a deploy never reaches an installed app.
      if (url.endsWith("/sw.js")) return answer(200, "", { "cache-control": "max-age=86400" });
      if (url.endsWith("/build.json")) return answer(404);
      return answer(200, "<html>", { "x-content-type-options": "nosniff" });
    };
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: "https://news.example",
      fetch: fake,
    });
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining(["site_headers", "site_stale", "site_update", "audio_unreachable"]),
    );
    expect(codes(report.findings, "fault")).not.toContain("site_api");
    expect(asked).toContain(`HEAD ${AUDIO}`);
  });

  // A run that died in install or on a timeout wrote nothing, so the last record still read as the
  // run before it; an episode or a config file that stopped parsing was found only when used.
  it("faults a run that died before it recorded anything, a broken episode and an invalid config file", async () => {
    await put("Podcasts/2026/10/ep-20261020-0900.md", "---\nid: ep-20261020-0900\n---\n\nHello.\n");
    await put("config/topics.json", JSON.stringify({ version: 9 }));
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: null,
      runs: [
        {
          databaseId: 7,
          status: "completed",
          conclusion: "failure",
          createdAt: "2026-10-21T07:13:00Z",
        },
      ],
    });
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining(["run_died", "episode_broken", "config_invalid"]),
    );
    expect(report.findings.some((each) => each.message.startsWith("config/topics.json"))).toBe(
      true,
    );
  });

  // A dry run or a delete writes no record and read as died; a cancel (the owner's, or a timeout:
  // GitHub reports both alike) is only a warning, so it never opens a fault on a guess.
  it("warns on a cancelled briefing run and never counts a dry run or a delete", () => {
    const run = (databaseId: number, conclusion: string, displayTitle: string) => ({
      databaseId,
      status: "completed",
      conclusion,
      createdAt: "2026-10-21T07:13:00Z",
      displayTitle,
    });
    const faults: string[] = [];
    const warnings: string[] = [];
    const sink = {
      fault: (code: string) => faults.push(code),
      warn: (code: string) => warnings.push(code),
      passed: [],
    };
    const records = [{ at: "2026-10-20T07:13:00Z" }];
    const quiet = [run(1, "failure", "dry run"), run(2, "failure", "delete 2026-10-20")];
    checkRunsDied(records, [...quiet, run(3, "cancelled", "run")], NOW, sink);
    expect({ faults, warnings }).toEqual({ faults: [], warnings: ["run_cancelled"] });
  });

  // Any run under way silenced the check, so an hourly run in progress hid one that died before it.
  it("stands down for a run under way only when it is newer than the one that died", () => {
    const run = (databaseId: number, status: string, createdAt: string) => ({
      databaseId,
      status,
      conclusion: status === "completed" ? "failure" : null,
      createdAt,
      displayTitle: "run",
    });
    const faults: string[] = [];
    const sink = { fault: (code: string) => faults.push(code), warn: () => {}, passed: [] };
    const records = [{ at: "2026-10-20T07:13:00Z" }];
    const died = run(1, "completed", "2026-10-21T07:13:00Z");
    checkRunsDied(records, [died, run(2, "in_progress", "2026-10-21T06:13:00Z")], NOW, sink);
    expect(faults).toEqual(["run_died"]);
    checkRunsDied(records, [died, run(3, "queued", "2026-10-21T08:13:00Z")], NOW, sink);
    expect(faults).toEqual(["run_died"]);
  });

  // A slow or shifting page reached the owner's phone with nothing saying so; a probe that could
  // not run must say so too, never read as a pass.
  it("warns on a page over a budget, passes one inside it and never faults", () => {
    const warnings: string[] = [];
    const sink = {
      fault: (code: string) => warnings.push(`fault ${code}`),
      warn: (code: string, _aspect: string, message: string) => warnings.push(`${code} ${message}`),
      passed: [] as string[],
    };
    const page = (path: string, lcp_ms: number, cls: number, tbt_ms: number) => ({
      page: path,
      lcp_ms,
      cls,
      tbt_ms,
    });
    checkPerf({ pages: [page("/", 900, 0.01, 40), page("/library", 9000, 0.6, 2000)] }, sink);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^perf_budget .*\/library/);
    expect(sink.passed).toHaveLength(1);
    warnings.length = 0;
    checkPerf({ pages: [page("/", 900, 0.01, 40)] }, sink);
    expect(warnings).toEqual([]);
    for (const unreadable of [null, { pages: [] }, { pages: [{ page: "/" }] }]) {
      warnings.length = 0;
      checkPerf(unreadable, sink);
      expect(warnings.map((line) => line.split(" ")[0])).toEqual(["perf_unmeasured"]);
    }
  });
});
