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
  // Absent until the owner first edits a structure (D170), and never committed by hand.
  "config/structure.json",
] as const;

/** The files a build may lack, which it carries as undefined. */
type OptionalBuiltPath = "config/structure.json";

/** The bundled files a deployment's function diffs from, by path: exactly BUILT_CONFIG_PATHS. */
export type BuiltConfigFiles = Readonly<
  Record<Exclude<(typeof BUILT_CONFIG_PATHS)[number], OptionalBuiltPath>, string> &
    Record<OptionalBuiltPath, string | undefined>
>;

/** A short digest of the files, a missing one read as empty. */
export function configHash(files: Readonly<Record<string, string | undefined>>): string {
  const text = JSON.stringify(BUILT_CONFIG_PATHS.map((path) => [path, files[path] ?? ""]));
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The digest of the files this build reads (the fixtures with SINGULARITY_FIXTURES=1), as the pages
 * read them. A file that is missing reads as empty; any other read error fails the build rather than
 * give its pages a digest no answer matches.
 */
export async function loadConfigHash(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  const texts = await Promise.all(
    BUILT_CONFIG_PATHS.map((path) =>
      readFile(join(base, path), "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }),
    ),
  );
  return configHash(Object.fromEntries(BUILT_CONFIG_PATHS.map((path, i) => [path, texts[i]])));
}
