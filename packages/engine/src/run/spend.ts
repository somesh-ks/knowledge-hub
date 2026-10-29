import { join } from "node:path";
import type { RunSpend } from "@singularity/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { firecrawlUsedSince, recordRunCosts } from "../cost/ledger.js";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import {
  EMPTY_FIRECRAWL_STATE,
  FIRECRAWL_WEEKLY_BUDGET,
  FirecrawlGuard,
} from "../fetch/firecrawlBudget.js";
import { RequestMeter } from "../llm/requestMeter.js";
import { loadScheduleZone } from "../schedule/store.js";
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

/** What a run has spent so far, as the run log prices it (D219). */
export interface SpendSnapshot {
  requests: Record<string, number>;
  units: Record<string, number>;
}

/** What `after` spent beyond `before`: one stage's share, as a spend that can be priced. */
export function spendDelta(before: SpendSnapshot, after: SpendSnapshot): SpendSnapshot {
  const minus = (a: Record<string, number>, b: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(a)
        .map(([key, n]) => [key, n - (b[key] ?? 0)] as const)
        .filter(([, n]) => n > 0),
    );
  return {
    requests: minus(after.requests, before.requests),
    units: minus(after.units, before.units),
  };
}

/**
 * The spend `.cache/run/spend.json` holds for `run`, or null when there is none or it is another
 * run's: the whole run, read by the run log after its stages (separate processes) have saved.
 */
export async function readRunSpend(root: string, run: string): Promise<SpendSnapshot | null> {
  const raw = await readJsonIfExists(spendPath(root), "spend.json").catch(() => null);
  const parsed = raw === null ? null : SpendFile.safeParse(raw);
  if (!parsed?.success || parsed.data.run !== run) return null;
  const requests: Record<string, number> = { ...parsed.data.requests };
  requests.firecrawl_listing = parsed.data.firecrawl.listing;
  requests.firecrawl_scrape = parsed.data.firecrawl.scrape;
  return { requests, units: { ...parsed.data.units } };
}

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

  /**
   * Load what earlier stages of `run` spent, without the weekly budget: for a process that only
   * reports the run (its failure record).
   */
  async resume(root: string, run: string): Promise<void> {
    if (this.run === run) return;
    this.run = run;
    this.base = {};
    this.baseUnits = {};
    this.guard.restore(EMPTY_FIRECRAWL_STATE);
    this.guard.limitTo(Number.POSITIVE_INFINITY);
    const raw = await readJsonIfExists(spendPath(root), "spend.json").catch(() => null);
    const parsed = raw === null ? null : SpendFile.safeParse(raw);
    if (parsed?.success && parsed.data.run === run) {
      this.base = { ...parsed.data.requests };
      this.baseUnits = { ...parsed.data.units };
      this.guard.restore(parsed.data.firecrawl);
    }
  }

  async begin(root: string, run: string, log?: Logger): Promise<void> {
    if (this.run === run) return;
    await this.resume(root, run);
    // The weekly budget: what other runs spent in the 7 days before this one (the ledger records a
    // run at its commit, or at its failure record, so the run in progress is never counted twice).
    // A ledger that does not read leaves the run its own ceiling, and says so.
    const started = Date.parse(run);
    if (!Number.isFinite(started)) {
      log?.warn("The run has no start time: Firecrawl's weekly budget is not applied", { run });
      return;
    }
    try {
      const since = new Date(started - WEEK_MS);
      const used = await firecrawlUsedSince(root, since, new Date(started), run);
      this.guard.limitTo(FIRECRAWL_WEEKLY_BUDGET - used);
    } catch (error) {
      log?.warn("The cost ledger did not read: Firecrawl's weekly budget is not applied", {
        reason: error instanceof Error ? error.message : String(error),
      });
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

  /** The run so far as a snapshot, to price a stage by the difference of two. */
  snapshot(): SpendSnapshot {
    return { requests: this.totals().requests, units: this.unitTotals() };
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

/**
 * Put a run's spend in the cost ledger, under its first pass's kind: at its commit, or with its
 * failure record. Never throws (`recordRunCosts`).
 */
export async function recordSpend(
  root: string,
  tracker: SpendTracker,
  plan: { created_at: string; passes: readonly { kind: string }[] },
  at: string,
): Promise<void> {
  await recordRunCosts(
    root,
    { requests: tracker.totals().requests, units: tracker.unitTotals() },
    { runId: plan.created_at, at, passKind: plan.passes[0]?.kind ?? "regular" },
    await loadScheduleZone(root),
  );
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
