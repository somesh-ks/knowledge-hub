import type { Outcome } from "@dispatch/core";
import type { Site } from "./site";

/** The body of /latest.json: just enough for the Generate sheet to see a new briefing go live. */
export interface LatestResponse {
  id: string | null;
  date: string | null;
  kind: string | null;
  generated_at: string | null;
  outcome: Outcome | null;
  outcome_at: string | null;
}

/** An explicit whitelist: nothing else from the run record or the digest can leak into the file. */
export function buildLatest(site: Pick<Site, "entries" | "lastRun">): LatestResponse {
  const latest = site.entries[0]?.digest;
  return {
    id: latest?.id ?? null,
    date: latest?.date ?? null,
    kind: latest?.kind ?? null,
    generated_at: latest?.generated_at ?? null,
    outcome: site.lastRun.outcome,
    outcome_at: site.lastRun.at,
  };
}
