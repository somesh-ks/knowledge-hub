import { buildManage } from "../lib/manage";
import { contentStateFile } from "./contentSources";
import type { ApiResult } from "./http";

/**
 * Each source's rating as the engine's last run left it (D173). The Sources pages are built with the
 * ratings of their build, and a run commits new stats without a deploy, so a page keeps showing last
 * week's ratings until a code change builds it again. This answers the current ones from the content
 * store; the page asks once and lays them over the rows (scripts/sourceRatings.ts), the pages staying
 * prerendered.
 *
 * Blob budget: the stats and health files are read through the content repository, whose manifest read
 * is one simple operation per instance per 30 s and whose files are hash-named, so the CDN serves
 * them. The answer itself is held at the edge for an hour, so a page view reaches no function at all
 * inside that hour, and the stats change at most once a run.
 */

export interface SourceRating {
  score: number | null;
  label: string;
  parts: { health: number; quality: number; trust: number | null } | null;
  why: string[];
  struggling: boolean;
}

export type SourceRatings = Record<string, SourceRating>;

/** An hour fresh at the edge, then served stale for a day while one request renews it. */
export const RATINGS_CDN_CACHE = "s-maxage=3600, stale-while-revalidate=86400";

/** The config the build holds, as text, with the sources and topics the ratings depend on. */
export interface RatingConfig {
  topicsFile: unknown;
  registry: unknown;
  user: unknown;
}

export interface RatingsDeps {
  /** The state file at a repository path, or undefined when the store cannot answer it. */
  state: (path: string) => Promise<{ text: string | null; stored: boolean }>;
  config: RatingConfig;
}

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleSourceRatings(
  deps: RatingsDeps,
): Promise<ApiResult<{ ratings: SourceRatings } | { error: string }>> {
  const [stats, health] = await Promise.all([
    deps.state("state/source-stats.json"),
    deps.state("state/source-health.json"),
  ]);
  // The build's copy of a state file is what the page already shows: nothing to lay over it, and
  // nothing worth holding at the edge.
  // A store without the stats file would rate every source as New and hold that at the edge.
  if (!stats.stored || stats.text === null || !health.stored)
    return { status: 503, body: { error: "unavailable" } };
  // Malformed stats would rate every source as New just the same.
  const parsedStats = parse(stats.text);
  if (parsedStats === null) return { status: 503, body: { error: "unavailable" } };
  const { sources: rows } = buildManage({
    ...deps.config,
    preferences: null,
    stats: parsedStats,
    health: parse(health.text),
    candidates: null,
  });
  const ratings: SourceRatings = {};
  for (const row of rows) {
    ratings[row.id] = {
      score: row.score,
      label: row.score_label,
      parts: row.score_parts ?? null,
      why: row.score_why,
      struggling: row.struggling,
    };
  }
  return {
    status: 200,
    body: { ratings },
    headers: { "Vercel-CDN-Cache-Control": RATINGS_CDN_CACHE },
  };
}

export const runtimeState = (path: string) => contentStateFile(path);
