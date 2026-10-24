import { type CostRecord, OWNER_USER, TIME_ZONE } from "@singularity/core";

/**
 * What Anthropic billed, from its cost report (Admin API). The ledger sees only the calls the app
 * makes; the episode eval, scripts run on a laptop and anything else on the key never reach it. The
 * report is the bill itself, so each UTC day's billed total less the ledger's Anthropic records for
 * that day is spend outside the app, shown as its own use. Off until ANTHROPIC_ADMIN_KEY is set.
 */

const COST_REPORT = "https://api.anthropic.com/v1/organizations/cost_report";
/** The report's largest page of daily buckets. */
const DAYS_PER_PAGE = 31;
/** Anthropic asks for at most one poll a minute; the bill moves slower than that anyway. */
const CACHE_MS = 10 * 60_000;
/** A gap under a cent is the ledger's rounding, not spend. */
const NOISE_USD = 0.01;

interface CostReportPage {
  data: Array<{ starting_at: string; results: Array<{ currency?: string; amount: string }> }>;
  has_more: boolean;
  next_page?: string | null;
}

let cached: { key: string; at: number; days: Map<string, number> } | null = null;

/** USD billed per UTC day from `from` to `to` (YYYY-MM-DD, inclusive). Throws on a failed read. */
export async function anthropicBilledDays(
  adminKey: string,
  from: string,
  to: string,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Map<string, number>> {
  const key = `${from}|${to}`;
  if (cached && cached.key === key && now - cached.at < CACHE_MS) return cached.days;
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
  const days = new Map<string, number>();
  let page: string | undefined;
  do {
    const params = new URLSearchParams({
      starting_at: `${from}T00:00:00Z`,
      ending_at: end,
      bucket_width: "1d",
      limit: String(DAYS_PER_PAGE),
    });
    if (page) params.set("page", page);
    const response = await fetchFn(`${COST_REPORT}?${params}`, {
      headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) throw new Error(`cost report answered ${response.status}`);
    const body = (await response.json()) as CostReportPage;
    for (const bucket of body.data) {
      // Amounts are decimal strings in cents.
      const cents = bucket.results.reduce((sum, result) => sum + Number(result.amount), 0);
      if (!Number.isFinite(cents)) throw new Error("cost report amount unreadable");
      const day = bucket.starting_at.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + cents / 100);
    }
    page = body.has_more && body.next_page ? body.next_page : undefined;
  } while (page);
  cached = { key, at: now, days };
  return days;
}

/** One record a day for what Anthropic billed beyond the ledger's Anthropic records of that day. */
export function outsideAppRecords(
  billed: ReadonlyMap<string, number>,
  engine: readonly CostRecord[],
  timezone: string = TIME_ZONE,
): CostRecord[] {
  const recorded = new Map<string, number>();
  for (const record of engine) {
    if (record.provider !== "anthropic") continue;
    const day = new Date(record.at).toISOString().slice(0, 10);
    recorded.set(day, (recorded.get(day) ?? 0) + record.usd);
  }
  const records: CostRecord[] = [];
  for (const [day, usd] of billed) {
    const gap = usd - (recorded.get(day) ?? 0);
    if (gap < NOISE_USD) continue;
    records.push({
      id: `billed|anthropic|${day}`,
      // The report is by UTC day: noon UTC keeps it on the same date in the report's zone.
      at: `${day}T12:00:00.000Z`,
      run_id: `billed-${day}`,
      kind: "outside_app",
      timezone,
      user: OWNER_USER,
      scope: "shared",
      stage: "billing",
      provider: "anthropic",
      product: "billed",
      units: {},
      usd: Math.round(gap * 1e6) / 1e6,
    });
  }
  return records;
}

/** For tests: forget the cached report. */
export function resetBillingCache(): void {
  cached = null;
}
