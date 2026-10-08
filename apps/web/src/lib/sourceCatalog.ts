import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * The source catalogue the Add a topic form offers from: config/source-catalog.json, read at build
 * time. An entry is an offer, not a source; nothing in it is fetched until the owner adds it.
 *
 * The engine writes the file and it may not exist yet, so a missing or malformed file is an empty
 * list, and a malformed entry is skipped, never guessed. Build time only: the page script gets the
 * entries as markup.
 */

export const CADENCES = ["daily", "several a week", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export interface CatalogSource {
  id: string;
  name: string;
  /** The feed the add operation sends. */
  feed_url: string;
  about: string;
  cadence: Cadence | null;
  tags: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** An http or https address, or null. */
function webAddress(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && url.hostname !== "" ? url.href : null;
  } catch {
    return null;
  }
}

/** The sources in a parsed catalogue file, in the file's order. */
export function parseSourceCatalog(file: unknown): CatalogSource[] {
  if (!isRecord(file) || !Array.isArray(file.sources)) return [];
  const seen = new Set<string>();
  const sources: CatalogSource[] = [];
  for (const entry of file.sources) {
    if (!isRecord(entry)) continue;
    const id = asText(entry.id);
    const name = asText(entry.name);
    const feed = webAddress(entry.feed_url);
    const tags = Array.isArray(entry.tags)
      ? [...new Set(entry.tags.map(asText).filter((tag): tag is string => tag !== null))].map(
          (tag) => tag.toLowerCase(),
        )
      : [];
    if (!id || !ID.test(id) || seen.has(id) || !name || !feed || tags.length === 0) continue;
    seen.add(id);
    const cadence = CADENCES.find((known) => known === entry.cadence) ?? null;
    sources.push({ id, name, feed_url: feed, about: asText(entry.about) ?? "", cadence, tags });
  }
  return sources;
}

/** How often a source posts, as a short phrase for its row. */
export function cadenceLabel(cadence: Cadence | null): string {
  switch (cadence) {
    case "daily":
      return "Posts daily";
    case "several a week":
      return "Posts several times a week";
    case "weekly":
      return "Posts weekly";
    case "monthly":
      return "Posts monthly";
    default:
      return "";
  }
}

/** The line under a source's name: what it covers, then how often it posts. */
export function catalogLine(source: Pick<CatalogSource, "about" | "cadence">): string {
  return [source.about, cadenceLabel(source.cadence)].filter(Boolean).join(" · ");
}

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
