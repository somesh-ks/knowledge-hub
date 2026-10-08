import type { Item, Source, SourceType } from "@dispatch/core";
import { FETCHERS } from "./fetchers.js";
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

/** Rejects when the signal aborts, so a fetcher that ignores its signal still cannot hang the run. */
function abortRace(signal: AbortSignal, ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error(`timed out after ${ms} ms`)), {
      once: true,
    });
  });
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

  const outcomes = await Promise.all(
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
        global.run(async (): Promise<{ items: Item[]; result: SourceResult }> => {
          const timeoutMs = limits[source.type]?.timeoutMs ?? defaultTimeout;
          const signal = AbortSignal.timeout(timeoutMs);
          const started = performance.now();
          const elapsed = (): number => Math.round(performance.now() - started);
          try {
            const fetcher = fetchers[source.type];
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
            if (error instanceof SourceSkipped) {
              return {
                items: [],
                result: {
                  source_id: source.id,
                  ok: true,
                  count: 0,
                  ms: elapsed(),
                  note: error.message,
                },
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
            };
          }
        }),
      );
    }),
  );

  return {
    items: outcomes.flatMap((outcome) => outcome.items),
    results: outcomes.map((outcome) => outcome.result),
  };
}
