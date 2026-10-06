import type { DigestKind, SourcesFile } from "@dispatch/core";
import { loadPreferences } from "../curate/inputs.js";
import { dedupe } from "../dedupe/dedupe.js";
import { fetchAll } from "../fetch/fetchAll.js";
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

  const { items, results } = await fetchAll(
    sources.sources,
    input.window,
    {
      http: setup.http,
      now: () => now,
      exa: { apiKey: setup.exaKey, queries: queries.queries },
      firecrawl: { apiKey: setup.firecrawlKey },
    },
    {
      mode: input.kind === "weekly" ? "weekly" : "regular",
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
