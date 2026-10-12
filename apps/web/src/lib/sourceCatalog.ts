import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";
import { type CatalogSource, parseSourceCatalog } from "./sourceCatalogMatch";

/**
 * The source catalogue the Add a topic form offers from: config/source-catalog.json, read at build
 * time. An entry is an offer, not a source; nothing in it is fetched until the owner adds it.
 *
 * The engine writes the file and it may not exist yet, so a missing or malformed file is an empty
 * list, and a malformed entry is skipped, never guessed. The build gives each topic's page its
 * offers as markup; /settings/source-catalog.json gives the Add panel the entries, for a topic added
 * before the build. The pure parts are in sourceCatalogMatch.ts, which the browser loads too.
 */

export * from "./sourceCatalogMatch";

export interface LoadCatalogOptions {
  root?: string;
  env?: Record<string, string | undefined>;
}

/** Reads the catalogue. With DISPATCH_FIXTURES=1 it reads the invented one, so a real build never shows it. */
export async function loadSourceCatalog(
  options: LoadCatalogOptions = {},
): Promise<CatalogSource[]> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  try {
    return parseSourceCatalog(
      JSON.parse(await readFile(join(base, "config", "source-catalog.json"), "utf8")),
    );
  } catch {
    return [];
  }
}
