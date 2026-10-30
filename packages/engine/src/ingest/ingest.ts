import { randomUUID } from "node:crypto";
import type { Item, Source, SourceType } from "@singularity/core";
import { type ExtractedText, extractFullText } from "../extract/extractText.js";
import { fetchAll } from "../fetch/fetchAll.js";
import { createLimiter } from "../fetch/limiter.js";
import type { FetchDeps, SourceFetcher, SourceResult } from "../fetch/types.js";
import type { FetchWindow } from "../gate/fetchWindow.js";
import type { BlobClient } from "../publish/blob.js";
import type { SqlClient } from "../store/configPaths.js";
import {
  type IngestItemRow,
  type IngestRunRecord,
  type KnownItems,
  MAX_ATTEMPTS,
  readKnownItems,
  readReferencedKeys,
  recordIngestItems,
  recordIngestRun,
  touchIngestItems,
} from "../store/ingestStore.js";

/**
 * Source types the ingest layer reads (D233): the ones that cost nothing per request. Exa and
 * Firecrawl spend a weekly allowance the daily run needs, YouTube falls back to Firecrawl when it
 * refuses the runner, and Alexandria is paid, so none of them run here until the shadow week has
 * shown what the free sources miss.
 */
export const INGEST_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  "rss",
  "github",
  "hn",
  "arxiv",
  "crossref",
  "lobsters",
  "producthunt",
]);

/** The feeds are read over this many days each run, so a story a run could not read is tried again. */
export const INGEST_WINDOW_DAYS = 3;
/** Stories read in one run; the rest wait for the next. Bounds the run's time, not its coverage. */
export const DEFAULT_MAX_EXTRACTIONS = 600;
const DEFAULT_CONCURRENCY = 8;
const ARCHIVE_PREFIX = "ingest/";
/** The pack's key is random and never changes, so a year of caching is safe. */
const ARCHIVE_CACHE_SECONDS = 365 * 24 * 60 * 60;

export interface IngestInput {
  sources: readonly Source[];
  window: FetchWindow;
  /** Null only for a dry run with no database: every story then counts as new. */
  sql: SqlClient | null;
  /** Null only for a dry run. */
  blob: BlobClient | null;
  fetchDeps: FetchDeps;
  now: () => Date;
  /** Replace source fetchers, for tests. */
  fetchers?: Partial<Record<SourceType, SourceFetcher>>;
  /** Replace the text extraction, for tests. The default is the free routes only. */
  extract?: (item: Item) => Promise<ExtractedText | null>;
  /** Replace the archive key's random part, for tests. */
  randomId?: () => string;
  maxExtractions?: number;
  concurrency?: number;
  githubRunId?: string | null;
  /** Read and count, change nothing. */
  dryRun?: boolean;
}

export interface IngestReport {
  run: IngestRunRecord;
  results: SourceResult[];
}

/**
 * Where a run's story texts live in Blob: one pack for the whole run. Vercel Blob counts every put
 * as one of the Hobby plan's 2,000 advanced operations a month, so a put a story spent that budget
 * in a day (2026-10-30); a put a run is three a day. Random, because a public Blob URL must not be
 * derivable from a story's address.
 */
export function archiveKey(now: Date, id: string): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ARCHIVE_PREFIX}${year}/${month}/${id}.json`;
}

type Outcome =
  | { kind: "archived"; item: Item; extracted: ExtractedText }
  | { kind: "unreadable"; item: Item }
  | { kind: "error"; item: Item };

/**
 * Reads the free sources, extracts every story the store does not hold, archives its text in Blob
 * and records it in Neon. Runs beside the daily fetch and changes nothing the briefing reads. A
 * story already archived is left alone; one no free route could read is tried again for
 * MAX_ATTEMPTS runs.
 */
export async function runIngest(input: IngestInput): Promise<IngestReport> {
  const { sql, blob } = input;
  if (!input.dryRun && (!sql || !blob))
    throw new Error("An ingest run needs the database and Blob.");
  const started = input.now();
  const startedMs = Date.now();
  const sources = input.sources.filter((source) => INGEST_SOURCE_TYPES.has(source.type));
  const { items: fetched, results } = await fetchAll(sources, input.window, input.fetchDeps, {
    mode: "weekly",
    ...(input.fetchers ? { fetchers: input.fetchers } : {}),
  });

  // Two sources can carry the same story; the copy with the most text of its own is the one to read.
  const textOf = (item: Item): number => (item.content ?? "").length + item.snippet.length;
  const best = new Map<string, Item>();
  for (const item of fetched) {
    const held = best.get(item.id);
    if (!held || textOf(item) > textOf(held)) best.set(item.id, item);
  }
  const unique = [...best.values()];
  const known: KnownItems = sql
    ? await readKnownItems(
        sql,
        unique.map((item) => item.id),
      )
    : new Map();
  const seenAgain = unique.filter((item) => known.get(item.id)?.status === "archived");
  const wanted = unique.filter((item) => {
    const row = known.get(item.id);
    return row === undefined || (row.status !== "archived" && row.attempts < MAX_ATTEMPTS);
  });
  const limit = input.maxExtractions ?? DEFAULT_MAX_EXTRACTIONS;
  const todo = wanted.slice(0, limit);
  const deferred = wanted.length - todo.length;

  const extract = input.extract ?? ((item: Item) => extractFullText(item, { scrape: null }));
  const randomId = input.randomId ?? randomUUID;
  let outcomes: Outcome[] = [];
  let packKey: string | null = null;
  if (!input.dryRun && blob) {
    const limiter = createLimiter(input.concurrency ?? DEFAULT_CONCURRENCY);
    outcomes = await Promise.all(
      todo.map((item) =>
        limiter.run(async (): Promise<Outcome> => {
          try {
            const extracted = await extract(item);
            return extracted ? { kind: "archived", item, extracted } : { kind: "unreadable", item };
          } catch {
            return { kind: "error", item };
          }
        }),
      ),
    );
    const archived = outcomes.flatMap((outcome) => (outcome.kind === "archived" ? [outcome] : []));
    if (archived.length > 0) {
      const key = archiveKey(started, randomId());
      const body = JSON.stringify({
        version: 2,
        items: archived.map(({ item, extracted }) => ({
          item_id: item.id,
          url: item.canonical_url,
          title: item.title,
          source_id: item.source_id,
          published_at: item.published_at ?? null,
          fetched_at: item.fetched_at,
          method: extracted.method,
          truncated: extracted.truncated,
          text: extracted.text,
        })),
      });
      try {
        await blob.put(key, new TextEncoder().encode(body), {
          contentType: "application/json",
          cacheControlMaxAge: ARCHIVE_CACHE_SECONDS,
        });
        packKey = key;
      } catch {
        // Nothing was saved, so no story has a row and the next run reads them all again.
        outcomes = outcomes.map((outcome) =>
          outcome.kind === "archived" ? { kind: "error", item: outcome.item } : outcome,
        );
      }
    }
  }

  const seenAt = started.toISOString();
  const rows: IngestItemRow[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "error") continue;
    const { item } = outcome;
    rows.push({
      item_id: item.id,
      canonical_url: item.canonical_url,
      source_id: item.source_id,
      title: item.title,
      published_at: item.published_at ?? null,
      seen_at: seenAt,
      status: outcome.kind,
      method: outcome.kind === "archived" ? outcome.extracted.method : null,
      chars: outcome.kind === "archived" ? outcome.extracted.text.length : 0,
      truncated: outcome.kind === "archived" ? outcome.extracted.truncated : false,
      archive_key: outcome.kind === "archived" ? packKey : null,
    });
  }

  const finished = input.now();
  const run: IngestRunRecord = {
    run_id: seenAt,
    started_at: seenAt,
    finished_at: finished.toISOString(),
    window_from: input.window.from.toISOString(),
    window_to: input.window.to.toISOString(),
    sources_ok: results.filter((result) => result.ok).length,
    sources_failed: results.filter((result) => !result.ok).length,
    fetched: unique.length,
    known: seenAgain.length,
    archived: outcomes.filter((outcome) => outcome.kind === "archived").length,
    unreadable: outcomes.filter((outcome) => outcome.kind === "unreadable").length,
    errors: outcomes.filter((outcome) => outcome.kind === "error").length,
    deferred,
    chars: rows.reduce((sum, row) => sum + row.chars, 0),
    ms: Date.now() - startedMs,
    github_run_id: input.githubRunId ?? null,
  };
  if (!input.dryRun && sql) {
    try {
      await recordIngestItems(sql, rows);
    } catch (error) {
      // The texts saved this run may have no row to find them by, and the next run would save them
      // again under new keys: take out those no row points at. A write whose answer was lost may
      // have landed, so a key is deleted only when the database confirms nothing refers to it.
      if (blob && packKey !== null) {
        try {
          const referenced = await readReferencedKeys(sql, [packKey]);
          if (!referenced.has(packKey)) await blob.del([packKey]);
        } catch {
          // Unknown is kept: a stray text costs a file, a deleted one costs a story.
        }
      }
      throw error;
    }
    await touchIngestItems(
      sql,
      seenAgain.map((item) => item.id),
      seenAt,
    );
    await recordIngestRun(sql, run);
  }
  return { run, results };
}
