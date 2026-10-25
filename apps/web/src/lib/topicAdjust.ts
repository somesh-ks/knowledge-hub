import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AutoAdjust, adjustmentAt } from "@singularity/core";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * What the owner's votes add to each topic's weight, read from config/profiles/owner.json at build
 * time and decayed to now. Topics with no adjustment are absent; a missing or unreadable file is
 * none. The slider keeps the owner's weight; this only feeds the "Adjusted" mark.
 */
export async function loadTopicAdjusts(
  options: { root?: string; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<Record<string, number>> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  try {
    const file = JSON.parse(await readFile(join(base, "config", "profiles", "owner.json"), "utf8"));
    const parsed = AutoAdjust.safeParse(file?.auto_adjust ?? {});
    if (!parsed.success) return {};
    const now = options.now ?? new Date();
    const out: Record<string, number> = {};
    for (const [id, entry] of Object.entries(parsed.data.topics)) {
      const value = adjustmentAt(entry, now);
      if (value !== 0) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}
