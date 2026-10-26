import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LastRunFile, type SourcesFile } from "@singularity/core";
import { afterEach, describe, expect, it } from "vitest";
import { extractFullText, FEED_TEXT_ENOUGH_CHARS } from "../src/extract/extractText.js";
import { createFirecrawlScrape } from "../src/extract/firecrawlScrape.js";
import {
  FIRECRAWL_LISTING_CEILING,
  FIRECRAWL_LISTING_SHARE,
  FIRECRAWL_RUN_CEILING,
  FIRECRAWL_WEEKLY_BUDGET,
  FirecrawlGuard,
  planFirecrawlListing,
} from "../src/fetch/firecrawlBudget.js";
import { SpendTracker, spendPath } from "../src/run/spend.js";
import { applySourceResults } from "../src/state/sourceHealth.js";
import { makeItem } from "./score-factories.js";

describe("the Firecrawl ceiling", () => {
  it("holds across listing and scraping together", async () => {
    const guard = new FirecrawlGuard();
    for (let i = 0; i < FIRECRAWL_LISTING_CEILING + 5; i++) {
      await guard.listing(`https://s${i}.example/`, async () => i);
    }
    expect(guard.snapshot.listing).toBe(FIRECRAWL_LISTING_CEILING);
    let scrapes = 0;
    while (guard.takeScrape()) scrapes += 1;
    expect(scrapes).toBe(FIRECRAWL_RUN_CEILING - FIRECRAWL_LISTING_CEILING);
    expect(guard.used).toBe(FIRECRAWL_RUN_CEILING);
    expect(await guard.listing("https://new.example/", async () => 1)).toBeNull();
  });

  it("reuses a page already fetched in the run at no cost", async () => {
    const guard = new FirecrawlGuard();
    await guard.listing("https://a.example/", async () => "page");
    expect(await guard.listing("https://a.example/", async () => "again")).toBe("page");
    expect(guard.snapshot.listing).toBe(1);
  });

  it("rotates skipped listing sources by oldest last_ok across two runs", () => {
    let sources: { id: string; last_ok?: string }[] = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
    }));
    const first = planFirecrawlListing(sources, 3);
    expect(first.run).toEqual(["a", "b", "c"]);
    expect(first.skipped).toEqual(["d", "e"]);
    // The ones that ran now carry a last_ok; the skipped ones do not.
    sources = sources.map((s) =>
      first.run.includes(s.id) ? { ...s, last_ok: "2026-10-06T06:00:00Z" } : s,
    );
    const second = planFirecrawlListing(sources, 3);
    expect(second.run.slice(0, 2)).toEqual(["d", "e"]);
    expect(second.skipped).toHaveLength(2);
    expect(second.skipped.every((id) => first.run.includes(id))).toBe(true);
  });

  it("gives every listing source a turn within a bounded number of runs, a failing one included", () => {
    // 6 sources, room for 2 per run, so each is due within 3 runs. "a" always fails (an empty
    // listing): by last_ok alone it would keep the oldest key and take a slot every run.
    const ids = ["a", "b", "c", "d", "e", "f"];
    let file: SourcesFile = {
      version: 1,
      sources: ids.map((id) => ({
        id,
        name: id,
        type: "firecrawl" as const,
        url: `https://${id}.example`,
        feed_url: null,
        tier: "daily" as const,
        high_signal: false,
        enabled: true,
        failures: 0,
        options: {},
      })),
    };
    const fetched = new Set<string>();
    for (let run = 0; run < 3; run++) {
      const { run: ran } = planFirecrawlListing(file.sources, 2);
      for (const id of ran) fetched.add(id);
      file = applySourceResults(
        file,
        ran.map((id) => ({ source_id: id, ok: id !== "a", count: 0, ms: 1 })),
        new Date(Date.UTC(2026, 9, 6 + 2 * run, 6)),
      );
    }
    expect([...fetched].sort()).toEqual(ids);
  });

  it("records skipped sources", () => {
    const guard = new FirecrawlGuard();
    guard.recordSkipped(["d", "e", "d"]);
    expect(guard.snapshot.skipped).toEqual(["d", "e"]);
  });
});

describe("the scrape fallback", () => {
  const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

  it("is skipped at 600 characters in hand and made at 599", async () => {
    let calls = 0;
    const scrape = async () => {
      calls += 1;
      return null;
    };
    const enough = makeItem({ snippet: "a".repeat(FEED_TEXT_ENOUGH_CHARS) });
    await extractFullText(enough, { fetchImpl: notFound, scrape });
    expect(calls).toBe(0);
    const short = makeItem({ snippet: "a".repeat(FEED_TEXT_ENOUGH_CHARS - 1) });
    await extractFullText(short, { fetchImpl: notFound, scrape });
    expect(calls).toBe(1);
  });

  it("stops after three 429s and later items fall back to the feed text", async () => {
    const guard = new FirecrawlGuard();
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      return new Response("", { status: 429, headers: { "retry-after": "1" } });
    }) as unknown as typeof fetch;
    const scrape = createFirecrawlScrape({
      apiKey: "k",
      fetchImpl,
      guard,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const first = await extractFullText(makeItem({ snippet: "b".repeat(300) }), {
      fetchImpl: notFound,
      scrape,
    });
    expect(requests).toBe(3);
    expect(guard.stopped).toBe(true);
    const second = await extractFullText(makeItem({ snippet: "c".repeat(300) }), {
      fetchImpl: notFound,
      scrape,
    });
    expect(requests).toBe(3);
    expect(first?.method).toBe("snippet");
    expect(second?.method).toBe("snippet");
  });
});

describe("the spend record", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("survives between stages and fits the last-run schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "spend-"));
    dirs.push(root);
    const run = "2026-10-08T06:00:00.000Z";
    const fetchStage = new SpendTracker();
    await fetchStage.begin(root, run);
    fetchStage.meter.add("exa", 4);
    await fetchStage.guard.listing("https://a.example/", async () => 1);
    fetchStage.guard.recordSkipped(["z"]);
    await fetchStage.save(root);

    const judgeStage = new SpendTracker();
    await judgeStage.begin(root, run);
    judgeStage.meter.add("jev", 7);
    await judgeStage.save(root);

    const commit = new SpendTracker();
    await commit.begin(root, run);
    const totals = commit.totals();
    expect(totals.requests).toMatchObject({ exa: 4, jev: 7, firecrawl_listing: 1 });
    expect(totals.firecrawl_skipped).toEqual(["z"]);
    const parsed = LastRunFile.parse({ version: 1, spend: { at: run, ...totals } });
    expect(parsed.spend?.requests.jev).toBe(7);
    expect(spendPath(root)).toContain("spend.json");

    // Another run's file is ignored.
    const other = new SpendTracker();
    await other.begin(root, "2026-10-10T06:00:00.000Z");
    expect(other.totals().requests.jev).toBeUndefined();
  });

  // The owner set Firecrawl to 100 requests a week (2026-10-24); a run only knew its own 30.
  it("gives a run what the 7 days before it left of the weekly budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "spend-"));
    dirs.push(root);
    // The week runs across a month, so it spans two ledger files.
    const run = "2026-11-02T05:37:00.000Z";
    const spent = (run_id: string, credits: number) => ({
      id: `${run_id}|daily|fetch|firecrawl|scrape|owner`,
      at: run_id,
      run_id,
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
    const month = (name: string, records: unknown[]) =>
      writeFile(join(root, `state/costs-${name}.json`), JSON.stringify({ version: 1, records }));
    await mkdir(join(root, "state"));
    const before = 30;
    const after = 40;
    await month("2026-10", [
      spent("2026-10-25T05:37:00.000Z", 50), // eight days back: outside the week
      spent("2026-10-29T05:37:00.000Z", before),
    ]);
    await month("2026-11", [
      spent("2026-11-01T05:37:00.000Z", after),
      spent(run, 20), // this run's own record never counts against it
      spent("2026-11-04T05:37:00.000Z", 25), // a later run's: after this one started
    ]);
    const tracker = new SpendTracker();
    await tracker.begin(root, run);
    const left = FIRECRAWL_WEEKLY_BUDGET - before - after;
    expect(left).toBeLessThan(FIRECRAWL_RUN_CEILING);
    expect(tracker.guard.scrapeRoom).toBe(left);
    expect(tracker.guard.listingRoom).toBe(Math.floor(left * FIRECRAWL_LISTING_SHARE));
    // A quiet week leaves the next run its own ceiling, though the same tracker held the last
    // one to less.
    await tracker.begin(root, "2026-11-20T05:37:00.000Z");
    expect(tracker.guard.scrapeRoom).toBe(FIRECRAWL_RUN_CEILING);
  });
});
