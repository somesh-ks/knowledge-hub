import type { Source } from "@singularity/core";

/**
 * Firecrawl requests all runs together may make in any 7 days, listing pages and article scrapes.
 * Read from the cost ledger at each stage (`run/spend.ts`). 100 (the owner, 2026-10-24) was spent
 * in four runs, and every daily after it aired without listings or scrapes; 300 is about 0.25 USD
 * (D222).
 */
export const FIRECRAWL_WEEKLY_BUDGET = 300;

/**
 * The most Firecrawl requests one run may make, listing pages and article scrapes together: a
 * fifth of the week, so a few runs can never spend it all. Metered by request, so the run holds
 * itself to a fixed number however many sources are configured. The 17 listing sources, the
 * YouTube feeds and the article scrapes of a daily come to about 40.
 */
export const FIRECRAWL_RUN_CEILING = 60;

/** Share of the ceiling that listing pages (sources of type firecrawl) may use; scraping gets the rest. */
export const FIRECRAWL_LISTING_SHARE = 0.55;

/** Listing requests one run may make. */
export const FIRECRAWL_LISTING_CEILING = Math.floor(
  FIRECRAWL_RUN_CEILING * FIRECRAWL_LISTING_SHARE,
);

/** After this many 429 replies in a run, Firecrawl is not called again until the next run. */
export const FIRECRAWL_RATE_LIMIT_STOP = 3;

/** Why a listing source did nothing, shown as the source's note in the fetch report. */
export const FIRECRAWL_SKIP_CEILING = "skipped: Firecrawl listing ceiling reached this run";
export const FIRECRAWL_SKIP_WEEKLY =
  "skipped: Firecrawl's weekly budget left this run fewer listings";
export const FIRECRAWL_SKIP_STOPPED = "skipped: Firecrawl is rate limited, stopped for this run";

export interface FirecrawlState {
  listing: number;
  scrape: number;
  /** 429 replies seen. */
  rate_limited: number;
  /** Listing sources left out of this run for the ceiling. */
  skipped: string[];
}

export const EMPTY_FIRECRAWL_STATE: FirecrawlState = {
  listing: 0,
  scrape: 0,
  rate_limited: 0,
  skipped: [],
};

function turnKey(source: Pick<Source, "last_ok" | "last_try">): number {
  const at = source.last_try ?? source.last_ok;
  return at ? Date.parse(at) : Number.NEGATIVE_INFINITY;
}

/**
 * Pick which Firecrawl listing sources run. The ones fetched longest ago go first (never fetched
 * counts as longest), so a source skipped today leads tomorrow and the skipped set rotates
 * instead of always hitting the same sources. The key is `last_try` (a run that tried, win or
 * lose), else `last_ok`: a failing or empty source would otherwise keep the oldest `last_ok` and
 * take the first slot every run. A skipped source is not tried, so it keeps its age. With `lean` (the owner's votes), liked sources run before
 * neutral ones and disliked sources go last, so the ceiling skips them first.
 */
export function planFirecrawlListing(
  sources: readonly Pick<Source, "id" | "last_ok" | "last_try">[],
  allowance: number,
  lean: (id: string) => number = () => 0,
): { run: string[]; skipped: string[] } {
  const room = Math.max(0, Math.floor(allowance));
  const oldestFirst = [...sources].sort((a, b) => {
    const side = Math.sign(lean(b.id)) - Math.sign(lean(a.id));
    if (side !== 0) return side;
    const left = turnKey(a);
    const right = turnKey(b);
    return left === right ? a.id.localeCompare(b.id) : left - right;
  });
  return {
    run: oldestFirst.slice(0, room).map((source) => source.id),
    skipped: oldestFirst.slice(room).map((source) => source.id),
  };
}

export interface FirecrawlLimits {
  ceiling?: number;
  listing?: number;
  stopAfter?: number;
}

/**
 * Counts and limits the Firecrawl requests of one run. Shared by the listing fetcher and the
 * scrape fallback, and carried between the stages of a run through the spend file. Scraping gets
 * whatever the listing did not use, so the two together never pass the ceiling.
 */
export class FirecrawlGuard {
  private state: FirecrawlState;
  private readonly limits: FirecrawlLimits;
  /** What the weekly budget left this run, when it is less than the run's own ceiling. */
  private weekly: number | null = null;
  private readonly pages = new Map<string, Promise<unknown>>();

  constructor(initial: FirecrawlState = EMPTY_FIRECRAWL_STATE, limits: FirecrawlLimits = {}) {
    this.state = { ...initial, skipped: [...initial.skipped] };
    this.limits = limits;
  }

  /**
   * Hold this run to `room` requests at most (what the weekly budget has left), the listing share
   * scaled with it. Never above the guard's own limits; a later call replaces an earlier one, and
   * a room that is not a number leaves the run its own limits.
   */
  limitTo(room: number): void {
    const own = this.limits.ceiling ?? FIRECRAWL_RUN_CEILING;
    const left = Number.isFinite(room) ? Math.max(0, Math.floor(room)) : own;
    this.weekly = left < own ? left : null;
  }

  private get ceiling(): number {
    return this.weekly ?? this.limits.ceiling ?? FIRECRAWL_RUN_CEILING;
  }

  private get listingCeiling(): number {
    const own = this.limits.listing ?? FIRECRAWL_LISTING_CEILING;
    return this.weekly === null
      ? own
      : Math.min(own, Math.floor(this.weekly * FIRECRAWL_LISTING_SHARE));
  }

  /**
   * Why a listing source was left out: 429s, the week's budget when it lowered the run's
   * listings, or else the run's own ceiling.
   */
  get skipNote(): string {
    if (this.stopped) return FIRECRAWL_SKIP_STOPPED;
    const own = this.limits.listing ?? FIRECRAWL_LISTING_CEILING;
    return this.listingCeiling < own ? FIRECRAWL_SKIP_WEEKLY : FIRECRAWL_SKIP_CEILING;
  }

  /** Replace the counts, as when a later stage picks up what an earlier one spent. */
  restore(state: FirecrawlState): void {
    this.state = { ...state, skipped: [...state.skipped] };
  }

  get snapshot(): FirecrawlState {
    return { ...this.state, skipped: [...this.state.skipped] };
  }

  get stopped(): boolean {
    return this.state.rate_limited >= (this.limits.stopAfter ?? FIRECRAWL_RATE_LIMIT_STOP);
  }

  get used(): number {
    return this.state.listing + this.state.scrape;
  }

  /** Listing requests still allowed. */
  get listingRoom(): number {
    if (this.stopped) return 0;
    return Math.max(
      0,
      Math.min(this.listingCeiling - this.state.listing, this.ceiling - this.used),
    );
  }

  /** Scrape requests still allowed: the ceiling less everything already spent. */
  get scrapeRoom(): number {
    if (this.stopped) return 0;
    return Math.max(0, this.ceiling - this.used);
  }

  /** True when this run already fetched the page, so asking again is free. */
  has(url: string): boolean {
    return this.pages.has(url);
  }

  recordSkipped(ids: readonly string[]): void {
    this.state.skipped = [...new Set([...this.state.skipped, ...ids])];
  }

  noteRateLimited(): void {
    this.state.rate_limited += 1;
  }

  /** Take one scrape request from the budget; false means do not call. */
  takeScrape(): boolean {
    if (this.scrapeRoom <= 0) return false;
    this.state.scrape += 1;
    return true;
  }

  /**
   * One feed read through Firecrawl because its host refused the runner (fetchAll's relay), from
   * the scrape budget. A feed relayed earlier in the run (the weekly pass reads the same feeds as
   * the regular one) is reused at no cost. Returns null when the budget is spent or Firecrawl is
   * stopped.
   */
  async relay<T>(url: string, load: () => Promise<T>): Promise<T | null> {
    const key = `relay:${url}`;
    const known = this.pages.get(key);
    if (known) return (await known) as T;
    if (!this.takeScrape()) return null;
    const pending = load();
    this.pages.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      // A failed relay may be tried again, but the attempt stays counted.
      this.pages.delete(key);
      throw error;
    }
  }

  /**
   * One listing page. A page fetched earlier in the run (the weekly pass reads the same pages as
   * the regular one) is reused at no cost. Returns null when the budget is spent or Firecrawl is
   * stopped, so the caller skips the source.
   */
  async listing<T>(url: string, load: () => Promise<T>): Promise<T | null> {
    const known = this.pages.get(url);
    if (known) return (await known) as T;
    if (this.listingRoom <= 0) return null;
    this.state.listing += 1;
    const pending = load();
    this.pages.set(url, pending);
    try {
      return await pending;
    } catch (error) {
      // A failed page may be tried again, but the attempt stays counted.
      this.pages.delete(url);
      throw error;
    }
  }
}
