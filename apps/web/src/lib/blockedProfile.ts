import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blockedDomainOf } from "./blockedOutlets";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * The domains the owner has blocked, read from config/profiles/owner.json at build time. The file
 * does not exist until the first block; a missing or unreadable one is an empty list.
 */
export async function loadBlockedDomains(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<string[]> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  try {
    const file: unknown = JSON.parse(
      await readFile(join(base, "config", "profiles", "owner.json"), "utf8"),
    );
    const list = (file as { blocked_domains?: unknown } | null)?.blocked_domains;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    for (const entry of list) {
      const domain = typeof entry === "string" ? blockedDomainOf(entry) : null;
      if (domain) seen.add(domain);
    }
    return [...seen].sort();
  } catch {
    return [];
  }
}
