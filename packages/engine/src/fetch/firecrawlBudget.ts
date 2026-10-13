import type { Source } from "@dispatch/core";

/**
 * The most Firecrawl requests one run may make, listing pages and article scrapes together. The
 * free plan is rate limited and metered by request, so the run holds itself to a fixed number
 * however many sources are configured.
 */
export const FIRECRAWL_RUN_CEILING = 30;

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

/**
 * Pick which Firecrawl listing sources run. The ones fetched longest ago go first (never fetched
 * counts as longest), so a source skipped today leads tomorrow and the skipped set rotates
 * instead of always hitting the same sources. `last_ok` is only written for a successful fetch,
 * which a skipped source does not make. With `lean` (the owner's votes), liked sources run before
 * neutral ones and disliked sources go last, so the ceiling skips them first.
 */
export function planFirecrawlListing(
  sources: readonly Pick<Source, "id" | "last_ok">[],
  allowance: number,
  lean: (id: string) => number = () => 0,
): { run: string[]; skipped: string[] } {
  const room = Math.max(0, Math.floor(allowance));
  const oldestFirst = [...sources].sort((a, b) => {
    const side = Math.sign(lean(b.id)) - Math.sign(lean(a.id));
    if (side !== 0) return side;
    const left = a.last_ok ? Date.parse(a.last_ok) : Number.NEGATIVE_INFINITY;
    const right = b.last_ok ? Date.parse(b.last_ok) : Number.NEGATIVE_INFINITY;
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
  private readonly pages = new Map<string, Promise<unknown>>();

  constructor(initial: FirecrawlState = EMPTY_FIRECRAWL_STATE, limits: FirecrawlLimits = {}) {
    this.state = { ...initial, skipped: [...initial.skipped] };
    this.limits = limits;
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
    const ceiling = this.limits.ceiling ?? FIRECRAWL_RUN_CEILING;
    const listing = this.limits.listing ?? FIRECRAWL_LISTING_CEILING;
    return Math.max(0, Math.min(listing - this.state.listing, ceiling - this.used));
  }

  /** Scrape requests still allowed: the ceiling less everything already spent. */
  get scrapeRoom(): number {
    if (this.stopped) return 0;
    return Math.max(0, (this.limits.ceiling ?? FIRECRAWL_RUN_CEILING) - this.used);
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
