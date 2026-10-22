import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * Which config files a build was made from (D149): the pages carry it in their config-store tag, and
 * GET /api/config answers with the one of the files its function bundles. The store's edits are a
 * diff from those files, so a page from another build (a copy the service worker kept, a tab open
 * across a deploy) must not lay them over itself. Build and server side only.
 */
export const BUILT_CONFIG_PATHS = [
  "config/topics.json",
  "config/sources.json",
  "config/sources.user.json",
  "config/schedule.json",
  "config/preferences.json",
  "config/profiles/owner.json",
] as const;

/** A short digest of the files, a missing one read as empty. */
export function configHash(files: Readonly<Record<string, string | undefined>>): string {
  const text = JSON.stringify(BUILT_CONFIG_PATHS.map((path) => [path, files[path] ?? ""]));
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

let loaded: Promise<string> | undefined;

/**
 * The digest of the files this build reads (the fixtures with DISPATCH_FIXTURES=1), as the pages
 * read them; read once per build.
 */
export function loadConfigHash(): Promise<string> {
  loaded ??= readConfigHash();
  return loaded;
}

async function readConfigHash(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  const files: Record<string, string | undefined> = {};
  for (const path of BUILT_CONFIG_PATHS)
    files[path] = await readFile(join(base, path), "utf8").catch(() => undefined);
  return configHash(files);
}
