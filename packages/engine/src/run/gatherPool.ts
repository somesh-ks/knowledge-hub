import {
  type DigestKind,
  feedsGeneralOnly,
  type Item,
  type Source,
  type SourcesFile,
} from "@singularity/core";
import { loadPreferences } from "../curate/inputs.js";
import { dedupe } from "../dedupe/dedupe.js";
import { fetchAll, selectSources } from "../fetch/fetchAll.js";
import { planFirecrawlListing } from "../fetch/firecrawlBudget.js";
import type { PoolFile } from "../fetch/pool.js";
import { loadQueries } from "../fetch/queries.js";
import type { SourceResult } from "../fetch/types.js";
import { prefilter } from "../prefilter/prefilter.js";
import {
  createFileProfileStore,
  dropBlocked,
  isBlockedSource,
  OWNER_ID,
} from "../profile/profile.js";
import { sourceLean, votePreferences } from "../profile/votes.js";
import { loadSchedule } from "../schedule/store.js";
import { loadSources } from "../sources/registry.js";
import { overlayHealth } from "../state/sourceHealth.js";
import { readSeen, readSourceHealth } from "../state/store.js";
import { loadTopicsFile } from "../topics/store.js";
import { activeGeneralFrom, buildGeneralPool, type GeneralPoolFile } from "./generalNews.js";
import { generalIdsFor } from "./generalScope.js";
import type { FetchSetup } from "./types.js";

export interface GatherInput {
  root: string;
  now: Date;
  id: string;
  kind: DigestKind;
  window: { from: Date; to: Date };
  setup: FetchSetup;
  /**
   * Switched-off general news feeds due their weekly check (D70): read with the pass's general
   * feeds, so their stories are judged for their scores like the others, and kept out of
   * everything else as every general story is.
   */
  probeGeneral?: readonly Source[];
  /** The prefilter's main cap, sized to the stories the pass writes; absent keeps its default. */
  poolCap?: number;
}

export interface GatherResult {
  pool: PoolFile;
  results: SourceResult[];
  /** The registry with stored health overlaid, the base for the next health update. */
  sources: SourcesFile;
  /**
   * The stories of the general news feeds, kept out of the pool so they can only be judged for
   * their feeds' scores and read by episodes (D66). Null when no general source was read.
   */
  general: GeneralPoolFile | null;
  /**
   * Items fetched in the window that the prefilter left out of the pool, after dedupe: what the
   * scoring sample may judge for the score alone (D70).
   */
  leftovers: Item[];
  /** Items the owner's blocklist dropped before dedupe. */
  blocked: number;
  /** The blocklist this pass followed, for the scoring sample to follow too. */
  blockedDomains: readonly string[];
}

/**
 * Sources in, one ranked pool out: the same steps as `singularity fetch`, with the window and the id
 * supplied by the run plan. The weekly kind also runs weekly-tier sources; every other kind runs
 * daily-tier sources only.
 *
 * A source that feeds general news topics alone is read when one of its topics plays in the pass:
 * every general topic in a regular pass, those the weekly podcast does not skip in the weekly one. Its items skip the briefing's
 * dedupe, prefilter and caps entirely and become the general stories of the pass (generalNews.ts).
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
  // The owner's blocklist applies to every path: a blocked source is not fetched, and what the
  // others return (open search, listings, feeds) is cut before dedupe, judging or extraction.
  const profile = await createFileProfileStore(root).read(OWNER_ID);
  const blockedDomains = profile.blocked_domains;
  const votePrefs = votePreferences(profile.votes, input.now);

  // The regular pass reads every general topic (their feeds are scored); the weekly pass only
  // those its podcast plays, so a weekly that skips them all reads no general feed.
  const everyGeneral = activeGeneralFrom(await loadTopicsFile(root)).map((t) => t.id);
  const weeklyGeneral =
    input.kind === "weekly" ? generalIdsFor(await loadSchedule(root), "weekly", "weekly") : [];
  const activeGeneral = new Set(
    input.kind === "weekly"
      ? everyGeneral.filter((id) => weeklyGeneral.includes(id))
      : everyGeneral,
  );
  const generalSourceIds = new Set<string>();
  const probed = new Set((input.probeGeneral ?? []).map((source) => source.id));
  const runnable = sources.sources
    .filter((source) => !isBlockedSource(source, blockedDomains))
    // General feeds are read in regular passes only, whatever their tier. A switched-off one due
    // its check runs as if on, for this pass's general stories only.
    .map((source) =>
      feedsGeneralOnly(source.topic_ids)
        ? { ...source, tier: "daily" as const, enabled: source.enabled || probed.has(source.id) }
        : source,
    )
    .filter((source) => {
      if (!feedsGeneralOnly(source.topic_ids)) return true;
      if (!source.topic_ids?.some((id) => activeGeneral.has(id))) return false;
      generalSourceIds.add(source.id);
      return true;
    });

  // Over the listing ceiling, the Firecrawl sources fetched longest ago run and the rest wait for
  // the next run, so the skipped set rotates. Pages this run already holds cost nothing.
  const mode = input.kind === "weekly" ? "weekly" : "regular";
  const guard = setup.firecrawlGuard;
  const skip = new Map<string, string>();
  if (guard) {
    const listed = selectSources(runnable, mode).filter(
      (source) => source.type === "firecrawl" && !guard.has(source.feed_url ?? source.url),
    );
    const plan = planFirecrawlListing(listed, guard.listingRoom, (id) => sourceLean(votePrefs, id));
    for (const id of plan.skipped) skip.set(id, guard.skipNote);
    guard.recordSkipped(plan.skipped);
  }

  const { items: fetchedRaw, results } = await fetchAll(
    runnable,
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
  const { kept: fetchedItems, dropped: blocked } = dropBlocked(
    fetchedRaw,
    blockedDomains,
    (item) => item.url,
  );
  const items = fetchedItems.filter((item) => !generalSourceIds.has(item.source_id));
  const general =
    generalSourceIds.size > 0
      ? buildGeneralPool({
          items: fetchedItems.filter((item) => generalSourceIds.has(item.source_id)),
          sources: new Map(sources.sources.map((source) => [source.id, source])),
          activeTopicIds: activeGeneral,
          checked: probed,
        })
      : null;
  const deduped = dedupe({ items, sources: sources.sources, seen });
  const filtered = prefilter({
    items: deduped.items,
    preferences,
    sources: sources.sources,
    now,
    ...(input.poolCap === undefined ? {} : { cap: input.poolCap }),
  });
  const kept = new Set(filtered.items.map((item) => item.id));
  const leftovers = deduped.items.filter((item) => !kept.has(item.id));

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
  return { pool, results, sources, general, leftovers, blocked, blockedDomains };
}
