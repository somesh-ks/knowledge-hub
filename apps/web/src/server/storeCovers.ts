import { tmpdir } from "node:os";
import { join } from "node:path";
import { COVER_MODES } from "@singularity/cover";
import {
  COVER_SIZES,
  type CoverSource,
  coverPng,
  coverVersion,
  coverWebp,
  episodeCover,
  themedCoverSrc,
} from "../lib/covers";
import type { Site } from "../lib/site";
import { type BlobFetch, readPublicText } from "./blobStore";

/**
 * Covers for content the build has not drawn (D173). A page rendered from the content repository
 * can name a briefing or episode newer than the last deploy, and its cover routes are built. So
 * after each content sync this draws the covers the store's content needs, with the build's own
 * renderer, into content/covers/<path>, and vercel.json sends a /covers/ request the build cannot
 * answer there. A cover is drawn once per id: the next deploy builds it again from the checkout,
 * and a built file wins over the rewrite.
 */

export const COVERS_INDEX_KEY = "content/covers/index.json";

interface CoversIndex {
  version: 1;
  ids: string[];
  /**
   * The cover version each id was drawn for (lib/covers.ts coverVersion). A regenerated record has
   * a new version, so its cover is drawn again. An id listed without a version predates this field:
   * it counts as current once and is given its version, without a redraw.
   */
  versions?: Record<string, string>;
}

/** Every cover file one id is served as, by its site path without the leading slash. */
export function coverFiles(
  source: CoverSource,
): { path: string; source: CoverSource; png: boolean; size: 512 | 1024 }[] {
  return COVER_SIZES.flatMap((size) => [
    { path: `covers/${source.id}-${size}.png`, source, png: true, size },
    { path: `covers/${source.id}-${size}.webp`, source, png: false, size },
    ...COVER_MODES.map((mode) => ({
      path: themedCoverSrc(source.id, mode, size).slice(1),
      source: { ...source, mode },
      png: false,
      size,
    })),
  ]);
}

export interface StoreCoversDeps {
  site: Site;
  base: string;
  fetch: BlobFetch;
  put: (pathname: string, body: Uint8Array, contentType: string) => Promise<void>;
  now: () => number;
}

/** Draws and stores the covers the store does not have yet. Returns the ids it drew. */
export async function storeCovers(deps: StoreCoversDeps): Promise<string[]> {
  const text = await readPublicText(`${deps.base}/${COVERS_INDEX_KEY}?t=${deps.now()}`, deps.fetch);
  const index = text === null ? null : (JSON.parse(text) as Partial<CoversIndex>);
  const listed = new Set(index?.version === 1 && Array.isArray(index.ids) ? index.ids : []);
  const versions: Record<string, string> = { ...(index?.version === 1 ? index.versions : {}) };
  const records = [
    ...deps.site.entries.map((entry) => ({
      source: entry.digest as CoverSource,
      version: coverVersion(entry.digest.generated_at),
    })),
    ...deps.site.episodes.map((entry) => ({
      source: episodeCover(entry),
      version: coverVersion(entry.episode.generated_at),
    })),
  ];
  let adopted = false;
  const sources: CoverSource[] = [];
  for (const { source, version } of records) {
    if (versions[source.id] === version) continue;
    if (versions[source.id] === undefined && listed.has(source.id)) {
      // Drawn before versions were kept: current once, so no redraw; a regeneration differs later.
      versions[source.id] = version;
      adopted = true;
      continue;
    }
    sources.push(source);
  }
  if (sources.length === 0 && !adopted) return [];

  const cache = { cacheDir: join(tmpdir(), "singularity-store-covers"), fingerprint: "store" };
  for (const source of sources) {
    for (const file of coverFiles(source)) {
      const body = file.png
        ? await coverPng(file.source, file.size, cache)
        : await coverWebp(file.source, file.size, cache);
      await deps.put(`content/${file.path}`, body, file.png ? "image/png" : "image/webp");
    }
    listed.add(source.id);
    versions[source.id] = records.find((record) => record.source.id === source.id)?.version ?? "";
  }
  // Written last, so a run that dies half way draws the rest next time.
  const next: CoversIndex = { version: 1, ids: [...listed].sort(), versions };
  await deps.put(
    COVERS_INDEX_KEY,
    new TextEncoder().encode(JSON.stringify(next)),
    "application/json",
  );
  return sources.map((source) => source.id);
}
