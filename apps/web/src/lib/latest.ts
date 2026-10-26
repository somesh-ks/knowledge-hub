import type { Outcome } from "@singularity/core";
import type { Site } from "./site";

/** The body of /latest.json: just enough for the Generate sheet to see a new briefing go live. */
export interface LatestResponse {
  id: string | null;
  date: string | null;
  kind: string | null;
  generated_at: string | null;
  /** When the newest episode was written, so a page can see its own episode go live. */
  episode_at: string | null;
  episode_id: string | null;
  outcome: Outcome | null;
  outcome_at: string | null;
}

/**
 * What `/` shows: the most recently written item of any kind. Briefings sort by date and a catch-up
 * episode has no digest, so entries[0] alone kept Latest on the daily or weekly briefing.
 * `skip` holds ids this device deleted before the content store caught up: they are never chosen.
 */
export function newestItem(
  site: Pick<Site, "entries" | "episodes">,
  skip: ReadonlySet<string> = new Set(),
): { kind: "digest" | "episode"; id: string } | null {
  const digest = site.entries.find((entry) => !skip.has(entry.digest.id))?.digest;
  const episode = site.episodes.find((entry) => !skip.has(entry.id));
  if (episode && (!digest || episode.episode.generated_at > digest.generated_at)) {
    return { kind: "episode", id: episode.id };
  }
  return digest ? { kind: "digest", id: digest.id } : null;
}

/** An explicit whitelist: nothing else from the run record or the digest can leak into the file. */
export function buildLatest(
  site: Pick<Site, "entries" | "lastRun"> & { episodes?: Site["episodes"] },
): LatestResponse {
  const latest = site.entries[0]?.digest;
  return {
    id: latest?.id ?? null,
    date: latest?.date ?? null,
    kind: latest?.kind ?? null,
    generated_at: latest?.generated_at ?? null,
    episode_at: site.episodes?.[0]?.episode.generated_at ?? null,
    episode_id: site.episodes?.[0]?.id ?? null,
    outcome: site.lastRun.outcome,
    outcome_at: site.lastRun.at,
  };
}
