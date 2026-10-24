import { join } from "node:path";
import type { RunSpend } from "@dispatch/core";
import { z } from "zod";
import { firecrawlUsedSince } from "../cost/ledger.js";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import {
  EMPTY_FIRECRAWL_STATE,
  FIRECRAWL_WEEKLY_BUDGET,
  FirecrawlGuard,
} from "../fetch/firecrawlBudget.js";
import { RequestMeter } from "../llm/requestMeter.js";
import { runCacheDir } from "./plan.js";

const count = z.number().int().nonnegative();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** `.cache/run/spend.json`: what the stages of one run have spent so far, keyed by the run's plan. */
const SpendFile = z.object({
  version: z.literal(1),
  /** The plan's `created_at`; a file from another run is ignored. */
  run: z.string(),
  /** Jev, Exa and model-fallback counts. */
  requests: z.record(z.string(), count),
  /** Tokens and other units the providers reported, by `provider|product|unit`. */
  units: z.record(z.string(), z.number().nonnegative()).optional(),
  firecrawl: z.object({
    listing: count,
    scrape: count,
    rate_limited: count,
    skipped: z.array(z.string()),
  }),
});

export function spendPath(root: string): string {
  return join(runCacheDir(root), "spend.json");
}

export type SpendTotals = Pick<
  RunSpend,
  "requests" | "firecrawl_rate_limited" | "firecrawl_skipped"
>;

/**
 * Paid requests of one run, across stages that may be separate processes. The meter counts Jev,
 * Exa where they leave the process; the guard counts Firecrawl and enforces its
 * ceiling. Each stage calls `begin` first and `save` last (also on failure), so the commit stage
 * can report the whole run.
 */
export class SpendTracker {
  readonly meter = new RequestMeter();
  readonly guard = new FirecrawlGuard();
  private run: string | null = null;
  private base: Record<string, number> = {};
  private baseUnits: Record<string, number> = {};

  async begin(root: string, run: string): Promise<void> {
    if (this.run === run) return;
    this.run = run;
    this.base = {};
    this.baseUnits = {};
    this.guard.restore(EMPTY_FIRECRAWL_STATE);
    const raw = await readJsonIfExists(spendPath(root), "spend.json").catch(() => null);
    const parsed = raw === null ? null : SpendFile.safeParse(raw);
    if (parsed?.success && parsed.data.run === run) {
      this.base = { ...parsed.data.requests };
      this.baseUnits = { ...parsed.data.units };
      this.guard.restore(parsed.data.firecrawl);
    }
    // The weekly budget: what other runs spent in the 7 days before this one (the ledger records a
    // run at its commit, so the run in progress is never counted twice). A ledger that does not
    // read leaves the run its own ceiling.
    const started = Date.parse(run);
    if (Number.isFinite(started)) {
      const since = new Date(started - WEEK_MS);
      const used = await firecrawlUsedSince(root, since, run).catch(() => 0);
      this.guard.limitTo(FIRECRAWL_WEEKLY_BUDGET - used);
    }
  }

  totals(): SpendTotals {
    const requests = { ...this.base };
    for (const [service, n] of Object.entries(this.meter.peek())) {
      requests[service] = (requests[service] ?? 0) + n;
    }
    const firecrawl = this.guard.snapshot;
    requests.firecrawl_listing = firecrawl.listing;
    requests.firecrawl_scrape = firecrawl.scrape;
    return {
      requests,
      firecrawl_rate_limited: firecrawl.rate_limited,
      firecrawl_skipped: firecrawl.skipped,
    };
  }

  /** Reported units of the whole run so far, by `provider|product|unit`. */
  unitTotals(): Record<string, number> {
    const units = { ...this.baseUnits };
    for (const [key, n] of Object.entries(this.meter.peekUnits()))
      units[key] = (units[key] ?? 0) + n;
    return units;
  }

  /** Fold the meter into the saved totals and write the file. A failed write never fails a run. */
  async save(root: string): Promise<void> {
    if (this.run === null) return;
    for (const [service, n] of Object.entries(this.meter.take())) {
      this.base[service] = (this.base[service] ?? 0) + n;
    }
    for (const [key, n] of Object.entries(this.meter.takeUnits())) {
      this.baseUnits[key] = (this.baseUnits[key] ?? 0) + n;
    }
    try {
      await writeJson(spendPath(root), {
        version: 1,
        run: this.run,
        requests: this.base,
        units: this.baseUnits,
        firecrawl: this.guard.snapshot,
      });
    } catch {
      // The record is a convenience; the run goes on.
    }
  }
}

/** One line for a report: "jev 41, firecrawl_listing 14, ...". */
export function formatSpend(totals: SpendTotals): string {
  const parts = Object.entries(totals.requests)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, n]) => `${service} ${n}`);
  const notes: string[] = [];
  if (totals.firecrawl_rate_limited > 0) {
    notes.push(`firecrawl 429s ${totals.firecrawl_rate_limited}`);
  }
  if (totals.firecrawl_skipped.length > 0) {
    notes.push(`firecrawl skipped ${totals.firecrawl_skipped.join(", ")}`);
  }
  return [...parts, ...notes].join(", ") || "none";
}
