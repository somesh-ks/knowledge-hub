import type { Item, Source, SourceType } from "@singularity/core";
import { type HttpClient, HttpError } from "../http.js";
import { FETCHERS } from "./fetchers.js";
import { scrapeRaw } from "./firecrawl.js";
import { createLimiter, type Limiter } from "./limiter.js";
import {
  type FetchDeps,
  type FetchWindow,
  type SourceFetcher,
  type SourceResult,
  SourceSkipped,
} from "./types.js";

export interface TypeLimit {
  concurrency?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Per-type rules. Firecrawl's free plan allows 10 requests a minute with 2 in flight; arXiv asks
 * for one request every 3 seconds; Exa runs its own queries in parallel inside one source.
 */
export const DEFAULT_TYPE_LIMITS: Partial<Record<SourceType, TypeLimit>> = {
  firecrawl: { concurrency: 2, minIntervalMs: 6_500, timeoutMs: 45_000 },
  exa: { concurrency: 1, timeoutMs: 40_000 },
  arxiv: { concurrency: 1, minIntervalMs: 3_000 },
  crossref: { concurrency: 2 },
  // Reddit throttles unauthenticated clients hard; one listing every 2 seconds stays under it.
  reddit: { concurrency: 1, minIntervalMs: 2_000 },
};

export interface FetchAllOptions {
  /** "weekly" also runs weekly-tier sources; "regular" runs daily-tier sources only. */
  mode: "regular" | "weekly";
  concurrency?: number;
  /** Per-source deadline. */
  timeoutMs?: number;
  typeLimits?: Partial<Record<SourceType, TypeLimit>>;
  /** Replace fetchers, for tests. */
  fetchers?: Partial<Record<SourceType, SourceFetcher>>;
  /** Restrict the run to these source ids. */
  only?: readonly string[];
  /** Sources to leave alone this run, by id, with the note that explains why. */
  skip?: ReadonlyMap<string, string>;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchAllResult {
  items: Item[];
  results: SourceResult[];
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 15_000;
const ERROR_MAX = 200;

/** Sources this run should touch: enabled, in tier, optionally restricted by id. */
export function selectSources(
  sources: readonly Source[],
  mode: "regular" | "weekly",
  only?: readonly string[],
): Source[] {
  return sources.filter((source) => {
    if (!source.enabled) return false;
    if (source.tier === "weekly" && mode !== "weekly") return false;
    return only === undefined || only.includes(source.id);
  });
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, ERROR_MAX);
}

/**
 * YouTube answers its channel feeds with HTTP 404 to GitHub's runners (every run from about
 * 2026-10-14) while serving them to other hosts. A source it refused is fetched once more after
 * the first pass, its YouTube requests served through Firecrawl (`relay` below).
 */
const RELAYED_HOST = /^(www\.|m\.)?youtube\.com$/;

function onYoutube(url: string): boolean {
  try {
    return RELAYED_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** True when YouTube refused the runner: a 403, 404 or 429 from a youtube.com address. */
function refusedByYoutube(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    [403, 404, 429].includes(error.status ?? 0) &&
    onYoutube(error.url)
  );
}

interface Outcome {
  items: Item[];
  result: SourceResult;
  /** YouTube refused the runner; the second pass reads the source through Firecrawl. */
  refused?: boolean;
}

/** Rejects when the signal aborts, so a fetcher that ignores its signal still cannot hang the run. */
function abortRace(signal: AbortSignal, ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error(`timed out after ${ms} ms`)), {
      once: true,
    });
  });
}

/**
 * One source's fetch under its deadline (and the caller's signal). A skip is ok with a note; any
 * other error is a failure, marked `refused` when YouTube refused the runner.
 */
async function runSource(
  source: Source,
  fetcher: SourceFetcher | undefined,
  window: FetchWindow,
  deps: FetchDeps,
  timeoutMs: number,
  onError?: (error: unknown) => void,
): Promise<Outcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  try {
    if (!fetcher) throw new Error(`no fetcher for source type ${source.type}`);
    const sourceDeps: FetchDeps = {
      ...deps,
      signal: deps.signal ? AbortSignal.any([deps.signal, signal]) : signal,
    };
    const items = await Promise.race([
      fetcher(source, window, sourceDeps),
      abortRace(signal, timeoutMs),
    ]);
    return {
      items,
      result: { source_id: source.id, ok: true, count: items.length, ms: elapsed() },
    };
  } catch (error) {
    onError?.(error);
    if (error instanceof SourceSkipped) {
      return {
        items: [],
        result: { source_id: source.id, ok: true, count: 0, ms: elapsed(), note: error.message },
      };
    }
    return {
      items: [],
      result: {
        source_id: source.id,
        ok: false,
        count: 0,
        ms: elapsed(),
        error: describeError(error),
      },
      refused: refusedByYoutube(error),
    };
  }
}

/**
 * Fetch every selected source with bounded concurrency. One source failing, timing out or
 * returning garbage never affects another: the failure is recorded in its result and the run
 * continues. Items keep the order of `sources`, so the pool is reproducible.
 */
export async function fetchAll(
  sources: readonly Source[],
  window: FetchWindow,
  deps: FetchDeps,
  options: FetchAllOptions,
): Promise<FetchAllResult> {
  const selected = selectSources(sources, options.mode, options.only);
  const fetchers = { ...FETCHERS, ...options.fetchers };
  const limits = { ...DEFAULT_TYPE_LIMITS, ...options.typeLimits };
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const global = createLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);
  const perType = new Map<SourceType, Limiter>();
  const limiterFor = (type: SourceType): Limiter => {
    let limiter = perType.get(type);
    if (!limiter) {
      const limit = limits[type];
      limiter = createLimiter(limit?.concurrency ?? Number.POSITIVE_INFINITY, {
        ...(limit?.minIntervalMs ? { minIntervalMs: limit.minIntervalMs } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      });
      perType.set(type, limiter);
    }
    return limiter;
  };

  const outcomes: Outcome[] = await Promise.all(
    selected.map((source) => {
      const skipNote = options.skip?.get(source.id);
      if (skipNote !== undefined) {
        const skipped: { items: Item[]; result: SourceResult } = {
          items: [],
          result: { source_id: source.id, ok: true, count: 0, ms: 0, note: skipNote },
        };
        return Promise.resolve(skipped);
      }
      // The type limiter is entered first so a queue of slow-rate sources holds no global slot.
      return limiterFor(source.type).run(() =>
        global.run(() =>
          runSource(
            source,
            fetchers[source.type],
            window,
            deps,
            limits[source.type]?.timeoutMs ?? defaultTimeout,
          ),
        ),
      );
    }),
  );

  /**
   * A source YouTube refused, fetched again by its own fetcher with its YouTube requests served
   * through Firecrawl. It runs after the first pass, so it never holds a general slot while it
   * waits, under Firecrawl's limiter and deadline. Each feed is one request from the run's scrape
   * budget, never retried, and reused by a later pass (`FirecrawlGuard.relay`); a 429 counts toward
   * the run's stop. With no key or no budget left the refusal stands.
   */
  const relay = async (source: Source, first: Outcome): Promise<Outcome> => {
    const config = deps.firecrawl;
    if (!config?.apiKey) return first;
    const service = { apiKey: config.apiKey, baseUrl: config.baseUrl };
    const http: HttpClient = {
      fetchText: async (url, options) => {
        if (!onYoutube(url)) return deps.http.fetchText(url, options);
        const load = () => scrapeRaw(url, service, deps.http, options?.signal);
        const text = config.guard ? await config.guard.relay(url, load) : await load();
        if (text === null) throw new SourceSkipped("Firecrawl budget spent");
        return { url, status: 200, contentType: "application/xml", text };
      },
      getJson: (url, options) => deps.http.getJson(url, options),
      postJson: (url, body, options) => deps.http.postJson(url, body, options),
    };
    const again = await runSource(
      source,
      fetchers[source.type],
      window,
      { ...deps, http },
      limits.firecrawl?.timeoutMs ?? defaultTimeout,
      (error) => {
        if (error instanceof HttpError && error.status === 429) config.guard?.noteRateLimited();
      },
    );
    if (again.result.ok && again.result.note === undefined) {
      const ms = first.result.ms + again.result.ms;
      return { items: again.items, result: { ...again.result, ms, via: "firecrawl" } };
    }
    const why = again.result.error ?? again.result.note ?? "no result";
    const error = `${first.result.error}; through Firecrawl: ${why}`.slice(0, ERROR_MAX);
    return { items: [], result: { ...first.result, error } };
  };

  const final = await Promise.all(
    outcomes.map((outcome, index) => {
      const source = selected[index];
      return outcome.refused && source
        ? limiterFor("firecrawl").run(() => relay(source, outcome))
        : outcome;
    }),
  );

  return {
    items: final.flatMap((outcome) => outcome.items),
    results: final.map((outcome) => outcome.result),
  };
}
