import {
  buildReport,
  type CostRecord,
  dateInZone,
  GROUPS,
  type GroupBy,
  mergeRecords,
  OWNER_USER,
  PERIODS,
  type Period,
  type PriceTable,
  priceUnits,
  type Report,
  TIME_ZONE,
} from "@dispatch/core";
import type { NarrationState } from "./narrationState";

/**
 * The cost report behind Settings > Costs. Engine records (state/costs-*.json, bundled at build)
 * and the site's own Speechify spend (the narrate function's monthly usage documents in Blob, the
 * existing site-side store) are merged and totalled by the core's `buildReport`.
 */

/** Narration on Play, one record per digest per month, from the narrate function's usage document. */
export function narrationRecords(
  state: NarrationState,
  prices: PriceTable,
  timezone: string = TIME_ZONE,
): CostRecord[] {
  const records: CostRecord[] = [];
  for (const [digest, charge] of Object.entries(state.digests)) {
    const characters = charge.characters + (charge.repeats ?? 0);
    if (characters <= 0) continue;
    const product = "simba-3.2";
    const priced = priceUnits(prices, "speechify", product, { characters });
    records.push({
      id: `play|${state.speechify.month}|${digest}`,
      // The usage document keeps the day of the first narration, not the time: noon UTC of that day.
      at: `${charge.day}T12:00:00.000Z`,
      run_id: digest,
      kind: "narration_on_play",
      timezone,
      user: OWNER_USER,
      scope: "user",
      stage: "narration",
      provider: "speechify",
      product,
      units: { characters },
      usd: Math.round(priced.usd * 1e6) / 1e6,
      // The function charges a digest ahead of synthesis and pessimistically, so this is an upper bound.
      estimated: true,
      ...(priced.unpriced ? { unpriced: true } : {}),
    });
  }
  return records;
}

export interface CostQuery {
  period: Period;
  by: GroupBy;
  /** The last N local days, counting today. */
  days: number;
}

export interface CostBody {
  time_zone: string;
  prices_as_of: string;
  /** Prices the owner has not confirmed, as "provider/product". */
  unconfirmed: string[];
  report: Report;
}

export function parseCostQuery(params: URLSearchParams): CostQuery | null {
  const period = (params.get("period") ?? "day") as Period;
  const by = (params.get("by") ?? "provider") as GroupBy;
  const days = Number(params.get("days") ?? "30");
  if (!PERIODS.includes(period) || !GROUPS.includes(by)) return null;
  if (!Number.isInteger(days) || days < 1 || days > 366) return null;
  return { period, by, days };
}

export function costBody(
  query: CostQuery,
  input: { engine: CostRecord[]; site: CostRecord[]; prices: PriceTable; now: Date },
): CostBody {
  const records = mergeRecords(input.engine, input.site);
  const from = dateInZone(
    new Date(input.now.getTime() - (query.days - 1) * 86_400_000).toISOString(),
    TIME_ZONE,
  );
  return {
    time_zone: TIME_ZONE,
    prices_as_of: input.prices.as_of,
    unconfirmed: input.prices.prices
      .filter((entry) => !entry.confirmed)
      .map((entry) => `${entry.provider}/${entry.product}`),
    report: buildReport(records, {
      period: query.period,
      timeZone: TIME_ZONE,
      from,
      groupBy: query.by,
    }),
  };
}
