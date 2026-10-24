import type { Source, SourcesFile } from "@singularity/core";
import type { QueriesFile } from "../fetch/queries.js";
import { slugify } from "../normalize/slugify.js";
import { type MdRow, parseSourcesMd } from "./parseSourcesMd.js";
import {
  API_SEED,
  APP_TOPIC_SOURCES,
  CURATIONS,
  type Curation,
  GENERAL_TOPIC_SOURCES,
  GITHUB_SEED,
  ID_OVERRIDES,
  NAME_OVERRIDES,
  SEEDED_HOSTS,
  YOUTUBE_SEED,
} from "./seed.js";

export interface ImportResult {
  file: SourcesFile;
  queries: QueriesFile;
  warnings: string[];
}

/** Framework blogs listed only in the Firecrawl watch block of sources.md. */
const WATCH_SOURCES: Readonly<Record<string, { id: string; name: string }>> = {
  "nextjs.org/blog": { id: "nextjs-blog", name: "Next.js Blog" },
  "vitejs.dev/blog": { id: "vite-blog", name: "Vite Blog" },
  "astro.build/blog": { id: "astro-blog", name: "Astro Blog" },
  "svelte.dev/blog": { id: "svelte-blog", name: "Svelte Blog" },
  "nuxt.com/blog": { id: "nuxt-blog", name: "Nuxt Blog" },
  "bun.sh/blog": { id: "bun-blog", name: "Bun Blog" },
  "deno.com/blog": { id: "deno-blog", name: "Deno Blog" },
  "remix.run/blog": { id: "remix-blog", name: "Remix Blog" },
};

/** Host and path, lowercase, no www, no trailing slash: the identity of a page for matching. */
export function urlKey(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
}

function displayName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)/g, "").trim();
}

function baseSource(id: string, name: string, url: string, curation: Curation | undefined): Source {
  const source: Source = {
    id,
    name: NAME_OVERRIDES[id] ?? name,
    type: "firecrawl",
    url,
    feed_url: null,
    tier: curation?.tier ?? "daily",
    high_signal: curation?.high_signal ?? false,
    enabled: curation?.enabled ?? true,
    failures: 0,
    options: { ...curation?.options },
  };
  if (curation?.category_hint) source.category_hint = curation.category_hint;
  if (curation?.feed_hint) source.options.feed_hint = curation.feed_hint;
  if (curation?.pinned_feed_url) {
    source.type = "rss";
    source.feed_url = curation.pinned_feed_url;
  }
  return source;
}

function fromRow(row: MdRow, warnings: string[]): Source | null {
  let parsed: URL;
  try {
    parsed = new URL(row.url);
  } catch {
    warnings.push(`skipped "${row.name}": invalid URL ${row.url}`);
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (SEEDED_HOSTS.has(host)) return null;

  const name = displayName(row.name);
  const slug = slugify(name);
  const id = ID_OVERRIDES[slug] ?? slug;
  const curation = CURATIONS[id];
  const monthly = row.cadence !== undefined && /monthly/i.test(row.cadence);
  const source = baseSource(id, name, row.url, {
    ...curation,
    tier: curation?.tier ?? (monthly ? "weekly" : "daily"),
  });

  if (host === "github.com") {
    const repo = /^\/([^/]+\/[^/]+)\/releases/.exec(parsed.pathname)?.[1];
    if (!repo) return null;
    if (GITHUB_SEED.some((seed) => seed.repo.toLowerCase() === repo.toLowerCase())) return null;
    return {
      ...source,
      type: "github",
      feed_url: `https://github.com/${repo}/releases.atom`,
      options: { ...source.options, repo },
    };
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const handle = /\/@([^/]+)/.exec(parsed.pathname)?.[1];
    if (handle && YOUTUBE_SEED.some((seed) => seed.handle.toLowerCase() === handle.toLowerCase())) {
      return null;
    }
    return {
      ...source,
      type: "youtube",
      enabled: false,
      options: {
        ...source.options,
        ...(handle ? { handle } : {}),
        note: "channel id not resolved yet",
      },
    };
  }

  if (host === "daily.dev" || host === "www.daily.dev") {
    return {
      ...source,
      enabled: false,
      options: { ...source.options, note: "personalized feed behind an account; not automatable" },
    };
  }
  return source;
}

function githubSources(): Source[] {
  return GITHUB_SEED.map((seed) => ({
    ...baseSource(seed.id, seed.name, `https://github.com/${seed.repo}/releases`, {
      high_signal: seed.high_signal,
      category_hint: seed.category_hint,
    }),
    type: "github" as const,
    feed_url: `https://github.com/${seed.repo}/releases.atom`,
    options: { repo: seed.repo },
  }));
}

function youtubeSources(): Source[] {
  return YOUTUBE_SEED.map((seed) => ({
    // High signal: a video title rarely names a preferred keyword, so without it the prefilter
    // dropped every video before the judge saw one (25 of 25 from 9 to 24 October 2026).
    ...baseSource(seed.id, seed.name, `https://www.youtube.com/@${seed.handle}`, {
      category_hint: seed.category_hint,
      enabled: false,
      high_signal: true,
    }),
    type: "youtube" as const,
    options: {
      handle: seed.handle,
      note: "channel id not resolved yet; run singularity sources discover",
    },
  }));
}

function apiSources(): Source[] {
  return [...API_SEED, ...APP_TOPIC_SOURCES, ...GENERAL_TOPIC_SOURCES].map((draft) => ({
    ...draft,
    failures: 0,
  }));
}

/** Years go stale: freshness comes from the fetch window, so queries must not name one. */
export function stripYears(query: string): string {
  return query
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQueries(rawQueries: readonly string[]): QueriesFile {
  const seen = new Set<string>();
  const queries: QueriesFile["queries"] = [];
  for (const raw of rawQueries) {
    const query = stripYears(raw);
    if (query === "") continue;
    let id = slugify(query, 40) || "query";
    for (let n = 2; seen.has(id); n++) id = `${slugify(query, 36)}-${n}`;
    seen.add(id);
    queries.push({ id, query });
  }
  return { version: 1, queries };
}

/**
 * Keep what discovery and earlier runs learned; the table only supplies what is new.
 *
 * Discovery uses up two options and deletes them: the feed hint once a feed is known, and the
 * "channel id not resolved yet" note once the id is. The draft still carries both, so they are
 * left out here; otherwise every import would put them back and a resolved source would read as
 * unresolved.
 */
function mergeExisting(draft: Source, existing: Source | undefined): Source {
  if (!existing) return draft;
  const keepsDiscovery = existing.feed_url !== null && draft.feed_url === null;
  const options = { ...draft.options, ...existing.options };
  if (existing.feed_url !== null && existing.options.feed_hint === undefined) {
    delete options.feed_hint;
  }
  if (existing.options.channel_id !== undefined && existing.options.note === undefined) {
    delete options.note;
  }
  const merged: Source = {
    ...draft,
    type: keepsDiscovery ? existing.type : draft.type,
    feed_url: draft.feed_url ?? existing.feed_url,
    enabled: existing.enabled,
    failures: existing.failures,
    options,
  };
  if (existing.last_ok) merged.last_ok = existing.last_ok;
  // The format is not in sources.md: it is classified once and kept across regeneration.
  if (existing.format) merged.format = existing.format;
  // The lean is rated once (classify-lean) and kept the same way.
  if (existing.lean !== undefined) merged.lean = existing.lean;
  return merged;
}

/**
 * Build the initial registry from config/sources.md plus the code seed (GitHub repos, APIs,
 * YouTube channels). Pure and offline: feeds are filled in later by `singularity sources discover`.
 * Passing the current registry preserves discovered feeds, enabled flags and failure counters.
 */
export function buildRegistry(markdown: string, existing?: SourcesFile): ImportResult {
  const parsed = parseSourcesMd(markdown);
  const warnings: string[] = [];
  const drafts: Source[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();

  const add = (source: Source): void => {
    if (ids.has(source.id)) {
      warnings.push(`duplicate id ${source.id} skipped`);
      return;
    }
    const key = urlKey(source.url);
    // A repo and its docs page share no URL, so only page-type duplicates are caught here.
    if (source.type !== "github" && keys.has(key)) {
      warnings.push(`duplicate page ${source.url} skipped`);
      return;
    }
    ids.add(source.id);
    if (source.type !== "github") keys.add(key);
    drafts.push(source);
  };

  for (const row of parsed.rows) {
    const source = fromRow(row, warnings);
    if (source) add(source);
  }
  for (const url of parsed.watchUrls) {
    let key: string;
    try {
      key = urlKey(url);
    } catch {
      warnings.push(`skipped watch URL ${url}`);
      continue;
    }
    if (keys.has(key)) continue;
    const known = WATCH_SOURCES[key];
    const id = known?.id ?? `${slugify(key)}-watch`;
    add(baseSource(id, known?.name ?? key, url, CURATIONS[id]));
  }
  for (const source of [...githubSources(), ...youtubeSources(), ...apiSources()]) add(source);

  const existingById = new Map((existing?.sources ?? []).map((source) => [source.id, source]));
  const merged = drafts.map((draft) => mergeExisting(draft, existingById.get(draft.id)));
  const kept = (existing?.sources ?? []).filter((source) => !ids.has(source.id));
  return {
    file: { version: 1, sources: [...merged, ...kept] },
    queries: buildQueries(parsed.exaQueries),
    warnings,
  };
}
