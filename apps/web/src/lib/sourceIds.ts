import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * A story carries its outlet's name; a vote names the outlet by its id in config/sources.json. Read
 * once per build. A name the catalog does not know (a source removed since, a fixture) falls back to
 * the name written as a slug, which is how the catalog's own ids are made.
 */
let names: Promise<Map<string, string>> | undefined;

async function readNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (usesFixtures()) return map;
  try {
    const file = join(findRepoRoot(), "config", "sources.json");
    const catalog = JSON.parse(await readFile(file, "utf8")) as {
      sources?: Array<{ id?: unknown; name?: unknown }>;
    };
    for (const entry of catalog.sources ?? [])
      if (typeof entry.id === "string" && typeof entry.name === "string")
        map.set(entry.name, entry.id);
  } catch {
    // No catalog to read: every name falls back to its slug.
  }
  return map;
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";

/** The id of the source a story came from, by the name its digest carries. */
export async function sourceIdOf(name: string): Promise<string> {
  names ??= readNames();
  return (await names).get(name) ?? slug(name);
}
