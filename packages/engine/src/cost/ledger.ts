import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CostFile,
  type CostKind,
  type CostRecord,
  type CostScope,
  costFilePath,
  mergeRecords,
  OWNER_USER,
  PriceTable,
  priceUnits,
} from "@singularity/core";
import { writeJson } from "../curate/output.js";

/**
 * The cost ledger's engine side. Anything that makes a paid call records it with `recordPaidCalls`:
 * give it the provider, the product (model), the units the provider reported, and who the call is
 * for. It prices the units from config/prices.json and merges the records into
 * `state/costs-<YYYY-MM>.json` (the month of `at`, UTC) by id, so recording twice keeps one.
 */

export interface PaidCall {
  /** ISO time of the call, or of the run's commit for a run's roll-up. */
  at: string;
  /** The run the call belongs to; records of one run share it. */
  runId: string;
  kind: CostKind;
  /** The edition's zone. */
  timezone: string;
  /** Defaults to "owner". */
  user?: string;
  /** Defaults to shared for scheduled kinds (daily, weekly) and per-user for the rest. */
  scope?: CostScope;
  stage: string;
  provider: string;
  product: string;
  /** Units by name as the provider reports them: input_tokens, output_tokens, characters, credits, requests. */
  units: Record<string, number>;
  /** True when we counted a unit rather than reading it from the response. */
  estimated?: boolean;
  /**
   * Tells apart billings that share a run, stage and product (each segment of an episode, a failed
   * stream and its retry). Without it the id is one per run, so recording again keeps one.
   */
  event?: string;
}

export const defaultScope = (kind: CostKind): CostScope =>
  kind === "daily" || kind === "weekly" || kind === "config" ? "shared" : "user";

const PRICES_PATH = "config/prices.json";

export async function loadPrices(root: string): Promise<PriceTable> {
  return PriceTable.parse(JSON.parse(await readFile(join(root, PRICES_PATH), "utf8")));
}

export function toRecord(table: PriceTable, call: PaidCall): CostRecord {
  const user = call.user ?? OWNER_USER;
  const priced = priceUnits(table, call.provider, call.product, call.units);
  return {
    id: [call.runId, call.kind, call.stage, call.provider, call.product, user, call.event]
      .filter((part) => part !== undefined)
      .join("|"),
    at: call.at,
    run_id: call.runId,
    kind: call.kind,
    timezone: call.timezone,
    user,
    scope: call.scope ?? defaultScope(call.kind),
    stage: call.stage,
    provider: call.provider,
    product: call.product,
    units: call.units,
    usd: Math.round(priced.usd * 1e6) / 1e6,
    ...(call.estimated ? { estimated: true } : {}),
    ...(priced.unpriced ? { unpriced: true } : {}),
  };
}

async function readMonth(root: string, month: string): Promise<CostRecord[]> {
  try {
    const parsed = CostFile.parse(
      JSON.parse(await readFile(join(root, costFilePath(month)), "utf8")),
    );
    return parsed.records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Price the calls and merge them into the month files. Returns the records written. */
export async function recordPaidCalls(
  root: string,
  calls: readonly PaidCall[],
  table?: PriceTable,
): Promise<CostRecord[]> {
  const prices = table ?? (await loadPrices(root));
  const records = calls
    .filter((call) => Object.values(call.units).some((n) => n > 0))
    .map((call) => toRecord(prices, call));
  const months = new Set(records.map((record) => record.at.slice(0, 7)));
  for (const month of months) {
    const merged = mergeRecords(
      await readMonth(root, month),
      records.filter((record) => record.at.startsWith(month)),
    );
    await writeJson(join(root, costFilePath(month)), { version: 1, records: merged });
  }
  return records;
}

/** Every record in `state/costs-*.json`, oldest first. */
export async function loadAllCosts(root: string): Promise<CostRecord[]> {
  let names: string[];
  try {
    names = await readdir(join(root, "state"));
  } catch {
    return [];
  }
  const lists: CostRecord[][] = [];
  for (const name of names.sort()) {
    const match = /^costs-(\d{4}-\d{2})\.json$/.exec(name);
    if (match?.[1]) lists.push(await readMonth(root, match[1]));
  }
  return mergeRecords(...lists);
}

/** The UTC months from `since`'s to `until`'s, as the ledger's file names have them ("2026-10"). */
function monthsBetween(since: Date, until: Date): string[] {
  const months: string[] = [];
  const at = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
  while (at.getTime() <= until.getTime()) {
    months.push(at.toISOString().slice(0, 7));
    at.setUTCMonth(at.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Firecrawl requests (listing and scrape) the ledger records from `since` to `until`, other runs
 * only. Reads the month files the span touches (a record's month is that of its `at`).
 */
export async function firecrawlUsedSince(
  root: string,
  since: Date,
  until: Date,
  excludeRun: string,
): Promise<number> {
  const from = since.toISOString();
  const to = until.toISOString();
  const months = monthsBetween(since, until);
  const records = mergeRecords(...(await Promise.all(months.map((m) => readMonth(root, m)))));
  return records
    .filter(
      (record) =>
        record.provider === "firecrawl" &&
        record.product === "scrape" &&
        record.run_id !== excludeRun &&
        record.at >= from &&
        record.at <= to,
    )
    .reduce((sum, record) => sum + (record.units.credits ?? record.units.requests ?? 0), 0);
}

export interface RunSpendInput {
  /** Request counts by service, as the run's SpendTracker totals them. */
  requests: Readonly<Record<string, number>>;
  /** Reported units by `provider|product|unit`. */
  units: Readonly<Record<string, number>>;
}

const STAGE: Record<string, string> = {
  anthropic: "write",
  gemini: "extract",
  typesafe: "judge",
  exa: "fetch",
  firecrawl: "fetch",
};

/**
 * The paid calls of one run's spend: token units as the providers reported them (Anthropic,
 * Gemini), and request counts for the services that bill per request (Jev, Exa) or per
 * credit (Firecrawl, counted at one credit a request, so marked estimated).
 */
export function callsFromSpend(
  spend: RunSpendInput,
  base: Omit<PaidCall, "stage" | "provider" | "product" | "units" | "estimated">,
): PaidCall[] {
  const calls: PaidCall[] = [];
  const grouped = new Map<string, PaidCall>();
  for (const [key, n] of Object.entries(spend.units)) {
    const [provider = "", product = "", unit = ""] = key.split("|");
    const id = `${provider}|${product}`;
    const call = grouped.get(id) ?? {
      ...base,
      stage: STAGE[provider] ?? "other",
      provider,
      product,
      units: {},
    };
    call.units[unit] = (call.units[unit] ?? 0) + n;
    grouped.set(id, call);
  }
  // Alexandria credits the response did not report are counted at the capability's stated price:
  // they join the measured ones in one record, marked estimated.
  const alexandria = grouped.get("firecrawl|alexandria");
  if (alexandria?.units.credits_estimated) {
    alexandria.units.credits = (alexandria.units.credits ?? 0) + alexandria.units.credits_estimated;
    delete alexandria.units.credits_estimated;
    alexandria.estimated = true;
  }
  calls.push(...grouped.values());
  const requests = (name: string): number => spend.requests[name] ?? 0;
  const add = (
    provider: string,
    product: string,
    unit: string,
    n: number,
    estimated?: boolean,
  ): void => {
    if (n > 0) {
      calls.push({
        ...base,
        stage: STAGE[provider] ?? "other",
        provider,
        product,
        units: { [unit]: n },
        ...(estimated ? { estimated } : {}),
      });
    }
  };
  add("typesafe", "jev", "requests", requests("jev"));
  add("exa", "search", "requests", requests("exa"), true);
  add(
    "firecrawl",
    "scrape",
    "credits",
    requests("firecrawl_listing") + requests("firecrawl_scrape"),
    true,
  );
  return calls;
}

/**
 * What a spend costs in dollars, priced the way the ledger prices it (config/prices.json), without
 * recording anything: a stage's share of a run, for the run log (D221). A price file that does not
 * read, or a spend with nothing in it, is 0: the number is a measurement, it never stops a run.
 */
export async function priceSpend(
  root: string,
  spend: RunSpendInput,
  table?: PriceTable,
): Promise<number> {
  try {
    const prices = table ?? (await loadPrices(root));
    const calls = callsFromSpend(spend, {
      at: new Date(0).toISOString(),
      runId: "price",
      kind: "daily",
      timezone: "UTC",
    });
    return calls
      .filter((call) => Object.values(call.units).some((n) => n > 0))
      .reduce((sum, call) => sum + toRecord(prices, call).usd, 0);
  } catch {
    return 0;
  }
}

const KIND_OF_PASS: Record<string, CostKind> = {
  regular: "daily",
  weekly: "weekly",
  "on-demand": "on_demand",
};

/** The ledger kind of a digest or pass kind (regular, weekly, on-demand). */
export const costKindOf = (kind: string): CostKind => KIND_OF_PASS[kind] ?? "daily";

/**
 * Record a finished run's spend. Never throws: the ledger is a convenience, and a run that
 * published must not fail on it. A run of several passes is recorded under its first pass's kind.
 */
export async function recordRunCosts(
  root: string,
  spend: RunSpendInput,
  run: { runId: string; at: string; passKind: string },
  timezone: string,
): Promise<void> {
  try {
    const kind = costKindOf(run.passKind);
    await recordPaidCalls(
      root,
      callsFromSpend(spend, { at: run.at, runId: run.runId, kind, timezone }),
    );
  } catch {
    // Nothing to do: the run's own report still carries the request counts.
  }
}
