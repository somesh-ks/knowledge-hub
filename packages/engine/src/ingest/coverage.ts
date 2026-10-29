import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Digest, digestRelPath, parseDigestFile } from "@singularity/core";
import { listDigestIds } from "../state/digestIds.js";
import type { SqlClient } from "../store/configPaths.js";
import { readIngestTally, readKnownItems } from "../store/ingestStore.js";

/** The shadow exit (D233): this share of aired stories held, this share of pages read, for this many days. */
export const COVERAGE_TARGET = 0.9;
export const SHADOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface AiredStory {
  id: string;
  source_type: string;
  headline: string;
}

export interface DigestCoverage {
  id: string;
  aired: number;
  held: number;
  /** Aired stories the store does not hold, with the source type that brought them. */
  missing: AiredStory[];
}

export interface Coverage {
  /** The first ingest run; dailies aired before it are not counted, since nothing could hold them. */
  since: string | null;
  days_observed: number;
  digests: DigestCoverage[];
  aired: number;
  held: number;
  held_share: number | null;
  /** Aired and held, by the source type that brought the story: where the misses are. */
  by_source_type: Record<string, { aired: number; held: number }>;
  /** Pages tried in the window that a free route read. */
  read_share: number | null;
  /** True when both shares reach the target after SHADOW_DAYS of ingest. */
  met: boolean;
}

/** The regular dailies generated in the last `days` days, newest first. */
export async function readRecentDailies(root: string, now: Date, days: number): Promise<Digest[]> {
  const from = now.getTime() - days * DAY_MS;
  const dailies: Digest[] = [];
  for (const id of (await listDigestIds(root)).reverse()) {
    let digest: Digest;
    try {
      digest = parseDigestFile(await readFile(join(root, digestRelPath(id)), "utf8"));
    } catch {
      continue;
    }
    if (digest.kind !== "regular") continue;
    if (Date.parse(digest.generated_at) < from) break;
    dailies.push(digest);
  }
  return dailies;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/**
 * Measures the shadow (D233): how many of the stories each daily aired the store already held, and
 * how many of the pages ingest tried it could read. A story counts as held when its text is archived.
 */
export async function measureCoverage(input: {
  sql: SqlClient;
  dailies: readonly Digest[];
  now: Date;
  days?: number;
}): Promise<Coverage> {
  const days = input.days ?? SHADOW_DAYS;
  const from = new Date(input.now.getTime() - days * DAY_MS).toISOString();
  const tally = await readIngestTally(input.sql, from);
  const since = tally.first_run_at;
  const counted = input.dailies.filter((digest) => since !== null && digest.generated_at >= since);
  const known = await readKnownItems(
    input.sql,
    counted.flatMap((digest) => digest.items.map((item) => item.id)),
  );
  const bySourceType: Coverage["by_source_type"] = {};
  const digests: DigestCoverage[] = counted.map((digest) => {
    const missing: AiredStory[] = [];
    for (const item of digest.items) {
      const held = known.get(item.id)?.status === "archived";
      const entry = bySourceType[item.source_type] ?? { aired: 0, held: 0 };
      entry.aired += 1;
      if (held) entry.held += 1;
      bySourceType[item.source_type] = entry;
      if (!held)
        missing.push({ id: item.id, source_type: item.source_type, headline: item.headline });
    }
    return {
      id: digest.id,
      aired: digest.items.length,
      held: digest.items.length - missing.length,
      missing,
    };
  });
  const aired = digests.reduce((sum, digest) => sum + digest.aired, 0);
  const held = digests.reduce((sum, digest) => sum + digest.held, 0);
  const heldShare = share(held, aired);
  const readShare = share(tally.archived, tally.archived + tally.unreadable);
  const observed = since ? (input.now.getTime() - Date.parse(since)) / DAY_MS : 0;
  return {
    since,
    days_observed: Math.round(observed * 10) / 10,
    digests,
    aired,
    held,
    held_share: heldShare,
    by_source_type: bySourceType,
    read_share: readShare,
    met:
      observed >= days &&
      heldShare !== null &&
      readShare !== null &&
      heldShare >= COVERAGE_TARGET &&
      readShare >= COVERAGE_TARGET,
  };
}
