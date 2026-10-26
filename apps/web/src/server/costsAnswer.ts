import type { CostRecord, PriceTable } from "@singularity/core";
import { outsideAppRecords } from "./anthropicBilling";
import { type CostBody, type CostQuery, costBody } from "./costs";

/**
 * The cost report as /api/costs answers it. Each upstream call (the content store, the site's usage
 * documents in Blob, Anthropic's cost report) runs at once and has PART_TIMEOUT_MS: a call that is
 * late is marked missing and the rest is answered, so one slow part never holds the page. The last
 * complete answer is kept per instance and served at once while a new one is built (the answer is
 * private; the route sends no-store, so no CDN keeps it).
 */

/** The longest one upstream call may take before its part is given up. */
export const PART_TIMEOUT_MS = 4_000;
/** An answer this young is served as it is; an older one is served and rebuilt behind it. */
export const FRESH_MS = 20_000;
/** An answer older than this is not served; the request waits for a new one. */
const KEEP_MS = 6 * 3_600_000;

export interface CostSources {
  prices(): Promise<PriceTable | null>;
  /** The build's own copy, for when the store is late. */
  fallbackPrices(): PriceTable | null;
  engine(): Promise<CostRecord[]>;
  fallbackEngine(): CostRecord[];
  /** The site's own spend; null when it cannot be read. */
  site(prices: PriceTable): Promise<CostRecord[] | null>;
  /** USD billed per UTC day; null when billing is off (no Admin key); throws when unreadable. */
  billed(): Promise<Map<string, number> | null>;
}

export interface CostAnswer {
  body: CostBody & {
    engine: "ok" | "unavailable";
    site: "ok" | "unavailable";
    billing: "ok" | "unavailable" | "off";
    stale?: true;
  };
}

type Part<T> = { ok: true; value: T } | { ok: false };

async function inTime<T>(
  label: string,
  work: () => Promise<T>,
  ms: number,
  log: (message: string) => void,
): Promise<Part<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Part<T>>((resolve) => {
    timer = setTimeout(() => {
      log(`${label}: no answer in ${ms} ms`);
      resolve({ ok: false });
    }, ms);
  });
  const done = work().then(
    (value): Part<T> => ({ ok: true, value }),
    (error: unknown): Part<T> => {
      log(`${label}: ${error instanceof Error ? error.message : "unreadable"}`);
      return { ok: false };
    },
  );
  try {
    return await Promise.race([done, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Builds one answer: what is ready in time, each missing part named. Null: no price table, so no report. */
export async function costsAnswer(
  query: CostQuery,
  sources: CostSources,
  now: Date,
  options: { timeoutMs?: number; log?: (message: string) => void } = {},
): Promise<CostAnswer | null> {
  const ms = options.timeoutMs ?? PART_TIMEOUT_MS;
  const log = options.log ?? ((message: string) => console.error(`[api/costs] ${message}`));
  const pricesPart = inTime("prices", sources.prices, ms, log);
  const enginePart = inTime("engine", sources.engine, ms, log);
  // The site's records are priced, so this part waits for the prices inside its own limit.
  const sitePart = inTime(
    "site",
    async () => {
      const got = await pricesPart;
      const table = (got.ok ? got.value : null) ?? sources.fallbackPrices();
      return table ? sources.site(table) : null;
    },
    ms,
    log,
  );
  const billedPart = inTime("billing", sources.billed, ms, log);
  const [pricesGot, engineGot, siteGot, billedGot] = await Promise.all([
    pricesPart,
    enginePart,
    sitePart,
    billedPart,
  ]);
  const prices = (pricesGot.ok ? pricesGot.value : null) ?? sources.fallbackPrices();
  if (!prices) return null;
  const engine = engineGot.ok ? engineGot.value : sources.fallbackEngine();
  const site = siteGot.ok ? siteGot.value : null;
  const billed = billedGot.ok ? billedGot.value : undefined;
  return {
    body: {
      ...costBody(query, {
        engine,
        site: [...(site ?? []), ...(billed ? outsideAppRecords(billed, engine) : [])],
        prices,
        now,
      }),
      engine: engineGot.ok ? "ok" : "unavailable",
      site: site ? "ok" : "unavailable",
      billing: billed === undefined ? "unavailable" : billed === null ? "off" : "ok",
    },
  };
}

const complete = (answer: CostAnswer["body"]): boolean =>
  answer.engine === "ok" && answer.site === "ok" && answer.billing !== "unavailable";

const held = new Map<string, { at: number; answer: CostAnswer }>();
const refreshing = new Set<string>();

/** Forget the held answers. For tests. */
export function resetCostsCache(): void {
  held.clear();
  refreshing.clear();
}

/**
 * Stale-while-revalidate over `build`, per instance, keyed by the request. Only a complete answer
 * is kept, so a partial one never stands in for a good one.
 */
export async function serveCosts(
  key: string,
  build: () => Promise<CostAnswer | null>,
  now: number,
): Promise<CostAnswer | null> {
  const keep = (answer: CostAnswer | null): void => {
    if (answer && complete(answer.body)) held.set(key, { at: now, answer });
  };
  const entry = held.get(key);
  if (entry && now - entry.at < KEEP_MS) {
    if (now - entry.at < FRESH_MS) return entry.answer;
    if (!refreshing.has(key)) {
      refreshing.add(key);
      void build()
        .then(keep)
        .catch(() => undefined)
        .finally(() => refreshing.delete(key));
    }
    return { body: { ...entry.answer.body, stale: true } };
  }
  const answer = await build();
  keep(answer);
  return answer;
}
