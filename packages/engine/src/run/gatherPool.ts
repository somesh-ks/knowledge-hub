import type { DigestKind, SourcesFile } from "@dispatch/core";
import { loadPreferences } from "../curate/inputs.js";
import { dedupe } from "../dedupe/dedupe.js";
import { fetchAll, selectSources } from "../fetch/fetchAll.js";
import {
  FIRECRAWL_SKIP_CEILING,
  FIRECRAWL_SKIP_STOPPED,
  planFirecrawlListing,
} from "../fetch/firecrawlBudget.js";
import type { PoolFile } from "../fetch/pool.js";
import { loadQueries } from "../fetch/queries.js";
import type { SourceResult } from "../fetch/types.js";
import { prefilter } from "../prefilter/prefilter.js";
import { loadSources } from "../sources/registry.js";
import { overlayHealth } from "../state/sourceHealth.js";
import { readSeen, readSourceHealth } from "../state/store.js";
import type { FetchSetup } from "./types.js";

export interface GatherInput {
  root: string;
  now: Date;
  id: string;
  kind: DigestKind;
  window: { from: Date; to: Date };
  setup: FetchSetup;
}

export interface GatherResult {
  pool: PoolFile;
  results: SourceResult[];
  /** The registry with stored health overlaid, the base for the next health update. */
  sources: SourcesFile;
}

/**
 * Sources in, one ranked pool out: the same steps as `dispatch fetch`, with the window and the id
 * supplied by the run plan. The weekly kind also runs weekly-tier sources; every other kind runs
 * daily-tier sources only.
 */
export async function gatherPool(input: GatherInput): Promise<GatherResult> {
  const { root, now, setup } = input;
  const [configured, health, preferences, seen, queries] = await Promise.all([
    loadSources(root),
    readSourceHealth(root),
    loadPreferences(root),
    readSeen(root),
    loadQueries(root),
  ]);
  // Health lives in state/, not config/, so a run never rewrites hand-edited configuration.
  const sources = overlayHealth(configured, health);

  // Over the listing ceiling, the Firecrawl sources fetched longest ago run and the rest wait for
  // the next run, so the skipped set rotates. Pages this run already holds cost nothing.
  const mode = input.kind === "weekly" ? "weekly" : "regular";
  const guard = setup.firecrawlGuard;
  const skip = new Map<string, string>();
  if (guard) {
    const listed = selectSources(sources.sources, mode).filter(
      (source) => source.type === "firecrawl" && !guard.has(source.feed_url ?? source.url),
    );
    const plan = planFirecrawlListing(listed, guard.listingRoom);
    for (const id of plan.skipped)
      skip.set(id, guard.stopped ? FIRECRAWL_SKIP_STOPPED : FIRECRAWL_SKIP_CEILING);
    guard.recordSkipped(plan.skipped);
  }

  const { items, results } = await fetchAll(
    sources.sources,
    input.window,
    {
      http: setup.http,
      now: () => now,
      exa: { apiKey: setup.exaKey, queries: queries.queries },
      firecrawl: { apiKey: setup.firecrawlKey, guard },
    },
    {
      mode,
      ...(skip.size > 0 ? { skip } : {}),
      ...(setup.fetchers ? { fetchers: setup.fetchers } : {}),
      ...(setup.sleep ? { sleep: setup.sleep } : {}),
    },
  );
  const deduped = dedupe({ items, sources: sources.sources, seen });
  const filtered = prefilter({ items: deduped.items, preferences, sources: sources.sources, now });

  const pool: PoolFile = {
    version: 1,
    id: input.id,
    kind: input.kind,
    generated_at: now.toISOString(),
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
    sources: results,
    report: { fetched: items.length, dedupe: deduped.report, prefilter: filtered.report },
    items: filtered.items,
  };
  return { pool, results, sources };
}
