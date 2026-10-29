import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestRelPath, serializeDigestFile, VITAL_THRESHOLDS } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectHealth, type HealthFetch } from "../src/ops/health.js";
import {
  checkClientFaults,
  checkFieldVitals,
  checkPerf,
  checkRunsDied,
  checkStore,
  FIELD_MIN_SAMPLES,
  readStore,
  readWatchedHead,
  type StoreReading,
} from "../src/ops/healthChecks.js";
import { collectStatus } from "../src/ops/statusReport.js";
import { makeDigest } from "./audio-fixtures.js";
import { commitAll, git } from "./git-testRepo.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const AUDIO = "https://x.public.blob.vercel-storage.com/audio/2026-10-20.mp3";
let root: string;

async function put(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-health-"));
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

describe("singularity health", () => {
  // Each of these was an ordinary line in `singularity status` that nobody read.
  it("faults a failed run, a missed run, missing narration, a broken digest, a short episode, a thin podcast, a stub story and a runaway spend", async () => {
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

  // Firecrawl's 100 a week stopped 15 listing sources by Tuesday, because dry runs and regenerations
  // spend it too; it is now a soft ceiling (D222) that says so before it stops anything.
  it("warns when a week of Firecrawl passes one and a half normal weeks and faults at the stop", async () => {
    const spent = (credits: number, at = "2026-10-20T06:00:00Z", n = 0) => ({
      id: `fc-${at}-${n}`,
      at,
      run_id: at,
      kind: "daily",
      timezone: "Europe/Stockholm",
      user: "owner",
      scope: "shared",
      stage: "fetch",
      provider: "firecrawl",
      product: "scrape",
      units: { credits },
      usd: 0,
    });
    const read = async (credits: number[]) => {
      await writeFile(
        join(root, "state/costs-2026-10.json"),
        JSON.stringify({
          version: 1,
          records: credits.map((each, n) => spent(each, undefined, n)),
        }),
      );
      return collectHealth({ root, now: NOW, monthlyChars: 500_000, ceilingUsd: 5, site: null });
    };
    // Two records of 60 are 120 credits, under the alert: each needs its own id or they merge into one.
    const normal = await read([60, 60]);
    expect(codes(normal.findings, "warning")).not.toContain("firecrawl_week_high");
    expect(normal.passed).toContain("Firecrawl used 120 requests in 7 days");
    const high = await read([100, 60]);
    expect(codes(high.findings, "warning")).toContain("firecrawl_week_high");
    expect(codes(high.findings, "fault")).not.toContain("firecrawl_week_stopped");
    expect(codes((await read([200, 100])).findings, "fault")).toContain("firecrawl_week_stopped");
    // Eight days back is another week.
    const old = spent(400, "2026-10-12T06:00:00Z");
    await writeFile(
      join(root, "state/costs-2026-10.json"),
      JSON.stringify({ version: 1, records: [old] }),
    );
    const quiet = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 5,
      site: null,
    });
    expect(codes(quiet.findings, "fault")).not.toContain("firecrawl_week_stopped");
  });

  // A deploy Vercel skipped (a wrong author on Hobby) or one that lost vercel.json looks fine to CI.
  it("faults a live site that lost its headers, serves an old podcast or build, cannot tell an app it changed and lost the narration file", async () => {
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
      if (url.endsWith("/build.json")) return answer(200, '{"build":"0123456789ab"}');
      // The site narrated 460,000 characters itself; state/usage.json knows none of them.
      // Asked past the CDN copy: a cached count read last hour's spend.
      if (url.includes("/state/usage-2026-10.json?v=")) {
        return answer(
          200,
          JSON.stringify({
            version: 1,
            speechify: { month: "2026-10", characters: 460_000 },
          }),
        );
      }
      return answer(200, "<html>", { "x-content-type-options": "nosniff" });
    };
    const options = {
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: "https://news.example",
      fetch: fake,
    };
    // A push whose last commit touched no watched path: Vercel skipped the one that did.
    const skipped = (oldestMissingHours: number) => ({
      sha: "fedcba9876543210",
      at: NOW.getTime() - 3_600_000,
      includes: async () => false,
      missingSince: async () => NOW.getTime() - oldestMissingHours * 3_600_000,
    });
    const report = await collectHealth({ ...options, main: skipped(1) });
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining([
        "site_headers",
        "site_stale",
        "site_update",
        "audio_unreachable",
        "speech_budget",
      ]),
    );
    expect(codes(report.findings, "warning")).toContain("site_behind");
    expect(codes(report.findings, "fault")).not.toContain("site_api");
    expect(asked).toContain(`HEAD ${AUDIO}`);
    // #220's vercel.json failed every deploy for hours, and a warning reaches the owner only on
    // Mondays: a deploy missing a day is a fault, though a digest an hour old keeps landing.
    const dayOn = await collectHealth({ ...options, main: skipped(25) });
    expect(codes(dayOn.findings, "fault")).toContain("site_behind");
    expect(codes(dayOn.findings, "warning")).not.toContain("site_behind");
  });

  // Regenerating an older briefing keeps its date and id but writes a new generated_at; the site
  // still serves the newest by date, and health took the regenerated one for the newest and faulted.
  it("never calls the site stale for serving the newest podcast after an older one is regenerated", async () => {
    const regenerated = makeDigest({
      id: "2026-10-19",
      date: "2026-10-19",
      generated_at: "2026-10-21T10:00:00Z",
    });
    await put(digestRelPath(regenerated.id), serializeDigestFile(regenerated));
    // The site's count for October holds September's: the site itself reads that as unreadable.
    const usage = JSON.stringify({ speechify: { month: "2026-09", characters: 9 } });
    const fake: HealthFetch = async (url) => ({
      status: url.endsWith("/latest.json") || url.includes("/state/usage-") ? 200 : 404,
      headers: { get: () => null },
      text: async () => (url.includes("/state/usage-") ? usage : '{"id":"2026-10-20"}'),
    });
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: "https://news.example",
      fetch: fake,
    });
    expect(codes(report.findings, "fault")).not.toContain("site_stale");
    // `singularity status` had the same order and named the regenerated one as the latest.
    expect((await collectStatus(root, NOW, 500_000)).latest_digest?.id).toBe("2026-10-20");
    // A site count that does not read is said, and never stops the check.
    expect(codes(report.findings, "warning")).toContain("site_usage_unread");
  });

  // site_behind faulted a run on a feature branch (it read HEAD) and a site newer than the
  // checkout (git exits 128 on a commit it does not know, which read as "behind").
  it("reads the watched head from main, not HEAD, and cannot tell for a build it does not know", async () => {
    git(root, "init", "-q", "-b", "main");
    await put(
      "apps/web/vercel.json",
      JSON.stringify({ ignoreCommand: "git diff --quiet HEAD^ HEAD -- . ../../Digests" }),
    );
    const onMain = await commitAll(root, "chore: main");
    // Dependabot's merge, which Vercel Hobby never deploys: not the commit to wait for.
    await put("Digests/bot.md", "x");
    git(root, "add", "-A");
    git(root, "-c", "user.name=dependabot[bot]", "commit", "-q", "-m", "chore: bump");
    git(root, "checkout", "-q", "-b", "feature");
    await put("Digests/x.md", "x");
    const onFeature = await commitAll(root, "chore: feature");
    const head = await readWatchedHead(root);
    expect(head?.sha).toBe(onMain);
    expect(await head?.includes(onFeature)).toBe(true);
    expect(await head?.includes("0123456789ab")).toBeNull();
    // A daily digest restarted site_behind's clock on a deploy that kept failing: it runs from the
    // oldest commit the build lacks.
    git(root, "checkout", "-q", "main");
    await put("Digests/first.md", "x");
    process.env.GIT_COMMITTER_DATE = "2026-10-20T07:00:00Z";
    try {
      await commitAll(root, "chore: never deployed");
    } finally {
      delete process.env.GIT_COMMITTER_DATE;
    }
    await put("Digests/second.md", "x");
    const newest = await commitAll(root, "chore: nor this");
    const behind = await readWatchedHead(root);
    expect(behind?.sha).toBe(newest);
    expect(await behind?.missingSince(onMain)).toBe(Date.parse("2026-10-20T07:00:00Z"));
    expect(await behind?.missingSince("0123456789ab")).toBeNull();
  });

  // Client signals are forgeable and extensions trip the CSP, so they only warn, past a threshold,
  // over 24 hours across builds (content commits redeploy several times a day), and a stored
  // message reaches the issue as inline code, so an @mention in it pings no one.
  it("warns on a run of blocked scripts or errors across builds, and never faults", () => {
    const group = (
      kind: "csp" | "error" | "server" | "platform",
      build: string,
      day: number,
      extra = {},
    ) => ({
      kind,
      page: "/settings",
      message: kind === "error" ? "x is @someone`s" : "",
      directive: kind === "csp" ? "script-src-elem" : "",
      blocked: kind === "csp" ? "https://evil.example" : "",
      source: "",
      build,
      total: day,
      day,
      ...extra,
    });
    const found: string[] = [];
    const sink = {
      fault: (code: string, _: string, text: string) => found.push(`fault ${code} ${text}`),
      warn: (code: string, _: string, text: string) => found.push(`warn ${code} ${text}`),
      passed: [] as string[],
    };
    checkClientFaults(
      [
        group("csp", "build1", 2),
        group("csp", "build2", 1),
        group("error", "build1", 12),
        group("error", "build2", 8),
        group("error", "build2", 50, { message: "cross-origin script error" }),
        group("csp", "build0", 0, { total: 9 }),
        // A burst of 5xx a function answered: a warning, never a fault (a deploy or upstream blip).
        group("server", "build2", 3, { page: "api/podcast", message: "status 503" }),
        // Functions Vercel killed, which only the page saw: a warning too.
        group("platform", "build2", 3, {
          page: "api/narrate",
          message: "FUNCTION_INVOCATION_TIMEOUT",
        }),
      ],
      sink,
    );
    expect(found.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
      "warn client_faults",
      "warn client_faults",
      "warn client_faults",
      "warn client_faults",
    ]);
    expect(found[0]).toContain("`build1`, `build2`");
    expect(found[1]).toContain("`x is @someones`");
    expect(found[2]).toContain("`api/podcast`");
    expect(found[3]).toContain("`api/narrate`");
    found.length = 0;
    checkClientFaults([group("csp", "build1", 2), group("error", "build1", 19)], sink);
    expect(found).toEqual([]);
    checkClientFaults(null, sink);
    expect(sink.passed).toHaveLength(1);
  });

  // An invalid last-run.json used to reject the whole report instead of being named in it.
  it("reports an invalid last-run.json as a fault instead of failing", async () => {
    await put("state/last-run.json", "{ not json");
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: null,
    });
    expect(codes(report.findings, "fault")).toContain("state_invalid");
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
  it("warns on a cancelled podcast run and never counts a dry run or a delete", () => {
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
    const quiet = [
      run(1, "failure", "dry run scheduled"),
      run(2, "failure", "delete 2026-10-20"),
      run(4, "failure", "dry run"),
    ];
    // The names run.yml gives a briefing run since D217 count as one, the old "run" too.
    for (const name of ["run", "daily 2026-10-21", "weekly 2026-10-18", "regenerate 2026-10-19"]) {
      faults.length = 0;
      warnings.length = 0;
      checkRunsDied(records, [...quiet, run(3, "cancelled", name)], NOW, sink);
      expect({ faults, warnings }).toEqual({ faults: [], warnings: ["run_cancelled"] });
    }
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

  // A slow phone reached only the weekly lab probe: real visits whose 7-day p75 crossed Google's
  // lines said nothing. And a p75 of a handful of visits, or none, must never read as a pass.
  it("warns on a field p75 that needs improvement, faults at poor, and never passes too few", () => {
    const found: string[] = [];
    const sink = {
      fault: (code: string) => found.push(`fault ${code}`),
      warn: (code: string) => found.push(`warn ${code}`),
      passed: [] as string[],
    };
    const [inpGood] = VITAL_THRESHOLDS.inp;
    const [clsGood] = VITAL_THRESHOLDS.cls;
    const [, lcpPoor] = VITAL_THRESHOLDS.lcp;
    const summary = (
      metric: "lcp" | "inp" | "cls",
      device: string,
      samples: number,
      p75: number,
    ) => ({
      metric,
      device,
      samples,
      p75,
    });
    checkFieldVitals(
      {
        summaries: [
          summary("lcp", "mobile", FIELD_MIN_SAMPLES, lcpPoor + 1),
          summary("inp", "mobile", FIELD_MIN_SAMPLES, inpGood + 1),
          summary("cls", "mobile", FIELD_MIN_SAMPLES, clsGood),
          // A desktop with too few is not judged, and not a warning either: phones are the readers.
          summary("lcp", "desktop", FIELD_MIN_SAMPLES - 1, lcpPoor + 1),
        ],
      },
      sink,
    );
    expect(found).toEqual(["fault field_vitals", "warn field_vitals"]);
    expect(sink.passed).toHaveLength(1);

    found.length = 0;
    checkFieldVitals({ summaries: [summary("cls", "mobile", FIELD_MIN_SAMPLES - 1, 0)] }, sink);
    expect(found).toEqual(["warn field_unmeasured"]);
    found.length = 0;
    checkFieldVitals({ error: "no answer" }, sink);
    expect(found).toEqual(["warn field_unmeasured"]);
  });

  // A database error can name the address it failed to reach, password and all, and the reading's
  // message goes into the health issue.
  // The site fell back to per-instance caps and dropped vitals when Neon failed or the counter
  // table was missing, and health only warned that the vitals were unmeasured.
  it("reads the store with the database address taken out of any error, and faults a store that degrades the site", async () => {
    const url = "postgres://owner:pw-0123456789@ep-x.neon.invalid/neondb";
    const off = { configStore: false };
    const reading = await readStore(url, NOW, off, async () => {
      throw new Error(`could not connect to ${url} (password pw-0123456789)`);
    });
    expect("error" in reading && reading.error).not.toMatch(/pw-0123456789/);
    const noTable = await readStore(url, NOW, off, async () => ({
      query: async (text) => (text.includes("to_regclass") ? [{ present: false }] : []),
    }));
    const found = (each: StoreReading) => {
      const lines: string[] = [];
      checkStore(each, {
        fault: (code) => lines.push(`fault ${code}`),
        warn: (code) => lines.push(`warn ${code}`),
        passed: [],
      });
      return lines;
    };
    expect(found(reading)).toEqual(["warn store_degraded"]);
    // The first capped request creates the table, so its absence is no finding.
    expect(found(noTable)).toEqual(["warn field_unmeasured"]);
    const failedCheck = await readStore(url, NOW, off, async () => ({
      query: async (text) => {
        if (text.includes("to_regclass")) throw new Error("permission denied");
        return [];
      },
    }));
    expect(found(failedCheck)).toEqual(["warn store_degraded", "warn field_unmeasured"]);
    expect(found(await readStore(undefined, NOW, off))).toEqual(["warn field_unmeasured"]);
    // One read failing (an unseeded config store) used to throw the vitals and the counter away
    // and read as a degraded store.
    const unseeded = await readStore(url, NOW, { configStore: true }, async () => ({
      query: async (text) => {
        if (text.includes("config_documents")) throw new Error("relation does not exist");
        return text.includes("to_regclass") ? [{ present: true }] : [];
      },
    }));
    expect(found(unseeded)).toEqual(["warn field_unmeasured"]);
    expect("documents" in unseeded && unseeded.documents).toEqual({
      error: "relation does not exist",
    });
  });

  // With the config store on, a stored edit a run skipped (not JSON), would fail on (its schema) or
  // never committed reached no one: the owner's edit silently did nothing.
  it("faults stored config a run cannot use, warns on what git lacks and ignores stray rows", async () => {
    const schedule = JSON.stringify({
      version: 1,
      hour: 7,
      cadence_days: 2,
      length_minutes: 5,
      skip_topics: [],
    });
    await put("config/writer.json", "{}");
    const at = Date.parse("2026-10-09T00:00:00Z");
    const store: StoreReading = {
      field: { summaries: [] },
      rate_table: true,
      documents: [
        // Rows hydrateConfig never copies: ignored, never read from disk.
        { path: "../.env", content: "{not json", version: 1, updatedAt: at },
        { path: "config", content: "{}", version: 1, updatedAt: at },
        { path: "config/queries.json", content: "{not json", version: 1, updatedAt: at },
        { path: "config/topics.json", content: '{"version":9}', version: 1, updatedAt: at },
        {
          path: "config/schedule.json",
          content: schedule.replace("7", "8"),
          version: 2,
          updatedAt: at,
        },
        // Written after the last committed run (2026-10-10; the 10-18 failure committed nothing).
        {
          path: "config/writer.json",
          content: '{"a":1}',
          version: 2,
          updatedAt: Date.parse("2026-10-20T00:00:00Z"),
        },
      ],
    };
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: null,
      store,
    });
    const drift = (severity: string) =>
      report.findings
        .filter((each) => each.code === "config_store_drift" && each.severity === severity)
        .map((each) => each.message.match(/config\/[a-z./-]+\.json/)?.[0]);
    expect(drift("fault")).toEqual(["config/queries.json", "config/topics.json"]);
    // No record says when a run copied the store, so a stored edit git lacks only warns.
    expect(drift("warning")).toEqual(["config/schedule.json"]);
  });

  // health does not hydrate config: a briefing switched off only in the store read as overdue.
  it("does not call a podcast overdue that the stored schedule switched off", async () => {
    const stored = JSON.stringify({
      version: 1,
      hour: 7,
      cadence_days: 2,
      length_minutes: 5,
      skip_topics: [],
      enabled: false,
    });
    const store: StoreReading = {
      field: { summaries: [] },
      rate_table: true,
      documents: [
        { path: "config/schedule.json", content: stored, version: 2, updatedAt: Date.now() },
      ],
    };
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: null,
      store,
    });
    expect(codes(report.findings, "fault")).not.toContain("run_overdue");
    expect(report.passed).toContain("the daily podcast is switched off");
  });
});
