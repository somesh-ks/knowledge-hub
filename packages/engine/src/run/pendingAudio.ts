import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween, parseDigestFile, stockholmDate } from "@singularity/core";
import { listDigestTargets } from "../publish/publishAudio.js";

/** The deploy step retries narration for digests this recent when a run itself published nothing. */
export const DEPLOY_AUDIO_WINDOW_DAYS = 7;

/** Narration is kept this long; older digests have no player (build plan 7.7). */
export const AUDIO_RETENTION_DAYS = 120;

/**
 * Ids of digests dated within `windowDays` of today (Stockholm) whose frontmatter still has
 * `audio: null`, newest first. An unreadable digest is skipped: `singularity publish` reports it,
 * and counting it here would redeploy every day for nothing.
 */
export async function digestsLackingAudio(
  root: string,
  now: Date,
  windowDays: number,
): Promise<string[]> {
  const today = stockholmDate(now);
  const lacking: string[] = [];
  for (const target of await listDigestTargets(root)) {
    const age = daysBetween(target.id.slice(0, 10), today);
    if (age > windowDays) continue;
    try {
      const digest = parseDigestFile(await readFile(join(root, target.relPath), "utf8"));
      if (digest.audio === null) lacking.push(target.id);
    } catch {
      // Reported by `singularity publish`.
    }
  }
  return lacking;
}
