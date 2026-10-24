import { z } from "zod";

/**
 * The cost ledger. One CostRecord is one paid thing in one run: a provider's model or product with
 * the units it billed, priced from config/prices.json. A scheduled edition (fetch, judge, write,
 * narration) is `shared`: everyone in its timezone hears the same one. An on-demand episode or a
 * narration on Play is `user`: it belongs to whoever asked. Cost per user is their share of their
 * timezone's shared records plus their own (`costPerUser`).
 */

export const COST_KINDS = [
  "daily",
  "weekly",
  "catch_up",
  "on_demand",
  "narration_on_play",
  "config",
  /** What a provider billed beyond the ledger: evals, local scripts (apps/web anthropicBilling.ts). */
  "outside_app",
] as const;
export const CostKind = z.enum(COST_KINDS);
export type CostKind = z.infer<typeof CostKind>;

export const COST_SCOPES = ["shared", "user"] as const;
export const CostScope = z.enum(COST_SCOPES);
export type CostScope = z.infer<typeof CostScope>;

/** The owner is the only user until the app opens up. */
export const OWNER_USER = "owner";

export const CostRecord = z.object({
  /** Stable, so writing the same record twice keeps one. */
  id: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  /** The run (a plan's `created_at`, or a digest id) the record belongs to. */
  run_id: z.string().min(1),
  kind: CostKind,
  /** IANA zone of the edition: the schedule's zone for a scheduled run. */
  timezone: z.string().min(1),
  user: z.string().min(1),
  scope: CostScope,
  /** fetch, judge, write, llm, extract or narration. */
  stage: z.string().min(1),
  provider: z.string().min(1),
  /** The model or product the provider billed. */
  product: z.string().min(1),
  /** Units by name, such as input_tokens, output_tokens, characters, requests, credits. */
  units: z.record(z.string(), z.number().nonnegative()),
  usd: z.number().nonnegative(),
  /** True when a unit was counted by us rather than read from the provider's response. */
  estimated: z.boolean().optional(),
  /** True when a unit had no price: its cost counts as 0 here. */
  unpriced: z.boolean().optional(),
});
export type CostRecord = z.infer<typeof CostRecord>;

/** `state/costs-<YYYY-MM>.json`, the month of `at` in UTC. */
export const CostFile = z.object({
  version: z.literal(1),
  records: z.array(CostRecord),
});
export type CostFile = z.infer<typeof CostFile>;

export const costFilePath = (month: string): string => `state/costs-${month}.json`;

const UnitPrice = z.object({
  usd: z.number().nonnegative(),
  /** The quantity `usd` buys: 1000000 for "per million tokens". */
  per: z.number().positive(),
});

export const PriceEntry = z.object({
  provider: z.string().min(1),
  /** A model or product id; "*" matches any not listed for the provider. */
  product: z.string().min(1),
  units: z.record(z.string(), UnitPrice),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** False until the owner has checked the price against the provider's page. */
  confirmed: z.boolean(),
  note: z.string().optional(),
});
export type PriceEntry = z.infer<typeof PriceEntry>;

/** `config/prices.json`: the one place prices live. */
export const PriceTable = z.object({
  version: z.literal(1),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prices: z.array(PriceEntry),
});
export type PriceTable = z.infer<typeof PriceTable>;

export interface Priced {
  usd: number;
  /** Some unit had no price in the table. */
  unpriced: boolean;
  /** The entry used, for reports that flag unconfirmed prices. */
  entry: PriceEntry | null;
}

export function findPrice(table: PriceTable, provider: string, product: string): PriceEntry | null {
  const own = table.prices.filter((entry) => entry.provider === provider);
  return (
    own.find((entry) => entry.product === product) ?? own.find((e) => e.product === "*") ?? null
  );
}

/** USD for `units` of one provider's product. A unit with no price adds nothing and sets `unpriced`. */
export function priceUnits(
  table: PriceTable,
  provider: string,
  product: string,
  units: Readonly<Record<string, number>>,
): Priced {
  const entry = findPrice(table, provider, product);
  let usd = 0;
  let unpriced = entry === null;
  for (const [name, count] of Object.entries(units)) {
    const price = entry?.units[name];
    if (!price) {
      if (count > 0) unpriced = true;
      continue;
    }
    usd += (count / price.per) * price.usd;
  }
  return { usd, unpriced, entry };
}

// ---- Reports ----------------------------------------------------------------------------------

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const GROUPS = ["provider", "kind", "timezone", "user", "product", "scope"] as const;
export type GroupBy = (typeof GROUPS)[number];

/** The calendar date of an instant in an IANA zone, YYYY-MM-DD. DST is the zone's own. */
export function dateInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** The Monday on or before a YYYY-MM-DD date, as YYYY-MM-DD (calendar arithmetic, no clock). */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/** The bucket label of an instant: its day, the Monday of its week, or its month, in `timeZone`. */
export function bucketOf(iso: string, period: Period, timeZone: string): string {
  const date = dateInZone(iso, timeZone);
  if (period === "day") return date;
  return period === "week" ? weekStart(date) : date.slice(0, 7);
}

export interface Rollup {
  usd: number;
  records: number;
  /** Distinct run ids. */
  runs: number;
  /** The share of `usd` that is shared edition cost. */
  shared_usd: number;
  unpriced: boolean;
}

const emptyRollup = (): Rollup => ({ usd: 0, records: 0, runs: 0, shared_usd: 0, unpriced: false });

export interface ReportOptions {
  period: Period;
  /** The zone days are counted in. Defaults to UTC. */
  timeZone?: string;
  /** First and last local date to include, inclusive. */
  from?: string;
  to?: string;
  groupBy?: GroupBy;
}

export interface Report {
  /** Oldest first. */
  buckets: Array<{ bucket: string; total: Rollup; groups: Record<string, Rollup> }>;
  total: Rollup;
  /** Total USD over distinct runs. */
  per_run_usd: number;
  /** Total USD over distinct users. */
  per_user_usd: number;
  users: number;
}

interface Acc {
  r: Rollup;
  runs: Set<string>;
}

function add(acc: Acc, record: CostRecord): void {
  acc.r.usd += record.usd;
  acc.r.records += 1;
  if (record.scope === "shared") acc.r.shared_usd += record.usd;
  if (record.unpriced) acc.r.unpriced = true;
  // Billed spend outside the app is no run, so it does not lower the cost a run.
  if (record.kind !== "outside_app") acc.runs.add(record.run_id);
  acc.r.runs = acc.runs.size;
}

const acc = (): Acc => ({ r: emptyRollup(), runs: new Set() });

/** Totals by day, week or month in a zone, optionally grouped, with per-run and per-user averages. */
export function buildReport(records: readonly CostRecord[], options: ReportOptions): Report {
  const zone = options.timeZone ?? "UTC";
  const buckets = new Map<string, { total: Acc; groups: Map<string, Acc> }>();
  const total = acc();
  const users = new Set<string>();
  for (const record of records) {
    const day = dateInZone(record.at, zone);
    if ((options.from && day < options.from) || (options.to && day > options.to)) continue;
    const label = bucketOf(record.at, options.period, zone);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { total: acc(), groups: new Map() };
      buckets.set(label, bucket);
    }
    add(bucket.total, record);
    add(total, record);
    users.add(record.user);
    if (options.groupBy) {
      const key = record[options.groupBy];
      let group = bucket.groups.get(key);
      if (!group) {
        group = acc();
        bucket.groups.set(key, group);
      }
      add(group, record);
    }
  }
  return {
    buckets: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, data]) => ({
        bucket,
        total: data.total.r,
        groups: Object.fromEntries([...data.groups.entries()].map(([k, v]) => [k, v.r])),
      })),
    total: total.r,
    per_run_usd: total.r.runs ? total.r.usd / total.r.runs : 0,
    per_user_usd: users.size ? total.r.usd / users.size : 0,
    users: users.size,
  };
}

export interface CostUser {
  id: string;
  /** The zone of the edition this user is served. */
  timezone: string;
}

export interface UserCost {
  own_usd: number;
  shared_usd: number;
  total_usd: number;
}

/**
 * Cost per user: their own records, plus an even share of the shared records of their timezone.
 * Cost nobody can be charged with (a zone with no users, an unknown user) is returned as
 * `unallocated_usd`, so it is never lost.
 */
export function costPerUser(
  records: readonly CostRecord[],
  users: readonly CostUser[],
): { users: Record<string, UserCost>; unallocated_usd: number } {
  const result: Record<string, UserCost> = {};
  const byZone = new Map<string, string[]>();
  for (const user of users) {
    result[user.id] = { own_usd: 0, shared_usd: 0, total_usd: 0 };
    byZone.set(user.timezone, [...(byZone.get(user.timezone) ?? []), user.id]);
  }
  let unallocated = 0;
  for (const record of records) {
    if (record.scope === "user") {
      const own = result[record.user];
      if (own) own.own_usd += record.usd;
      else unallocated += record.usd;
      continue;
    }
    const members = byZone.get(record.timezone);
    if (!members?.length) {
      unallocated += record.usd;
      continue;
    }
    for (const id of members) {
      const share = result[id];
      if (share) share.shared_usd += record.usd / members.length;
    }
  }
  for (const cost of Object.values(result)) cost.total_usd = cost.own_usd + cost.shared_usd;
  return { users: result, unallocated_usd: unallocated };
}

/** Records of several lists, a repeated id kept once (the later list wins), oldest first. */
export function mergeRecords(...lists: ReadonlyArray<readonly CostRecord[]>): CostRecord[] {
  const byId = new Map<string, CostRecord>();
  for (const list of lists) for (const record of list) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}
