import type { ContentFiles } from "../lib/contentFiles";
import { loadSite, type Site } from "../lib/site";
import { type BlobFetch, readPublicText } from "./blobStore";
import { readPublicBlobBase, type ServerEnv } from "./config";

/**
 * The content repository (D173): the one place a page rendered on request gets its content. Today
 * it reads the content store in Blob, which `dispatch content sync` fills from git
 * (content/<repository path>, listed by content/manifest.json). With many users it reads Postgres
 * instead, one row per user, and no page changes.
 *
 * Blob budget: the manifest is read fresh (one SIMPLE operation) at most once per MANIFEST_TTL_MS
 * per function instance; every file is read by a URL that names its hash, so the CDN serves each
 * version from cache after its first read, for free.
 */

export const MANIFEST_TTL_MS = 30_000;

/**
 * How long Vercel's edge keeps a page rendered from the repository: a minute fresh, then served
 * while one request renders it again, so a visit seldom waits on the function. Browsers are not
 * told to keep it (vercel.json's no-cache stands), so a reload always asks the edge.
 */
export const CONTENT_CDN_CACHE = "max-age=60, stale-while-revalidate=600";
const MANIFEST_PATH = "content/manifest.json";

interface Manifest {
  version: 1;
  updated_at: string;
  files: Record<string, string>;
}

function parseManifest(text: string): Manifest | null {
  try {
    const value = JSON.parse(text) as Partial<Manifest>;
    if (value.version !== 1 || typeof value.updated_at !== "string" || !value.files) return null;
    return value as Manifest;
  } catch {
    return null;
  }
}

/** The store's files as the site's readers see them: repository paths, listed from the manifest. */
export function storeFiles(base: string, manifest: Manifest, doFetch: BlobFetch): ContentFiles {
  const paths = Object.keys(manifest.files).sort();
  return {
    async list(directory) {
      const prefix = `${directory.replace(/\/$/, "")}/`;
      return paths.filter((path) => path.startsWith(prefix));
    },
    async read(path) {
      const hash = manifest.files[path];
      if (hash === undefined) return null;
      return readPublicText(`${base}/content/${path}?v=${hash}`, doFetch);
    },
  };
}

export interface ContentRepoDeps {
  env: ServerEnv;
  fetch: BlobFetch;
  now: () => number;
  log?: (message: string) => void;
}

let held: { at: number; updatedAt: string; site: Promise<Site> } | null = null;

/** Forget what this instance holds. For tests. */
export function resetContentRepo(): void {
  held = null;
}

/**
 * The site's content from the store: newest first, parsed by the same readers as the build. Null
 * when the store is not configured or has no manifest, so the caller can answer "unavailable".
 */
export async function loadStoreSite(deps: ContentRepoDeps): Promise<Site | null> {
  if (held && deps.now() - held.at < MANIFEST_TTL_MS) return held.site;
  const base = readPublicBlobBase(deps.env);
  if (base === null) return null;
  // `t` is never used by the store; it makes a URL the CDN has not cached.
  const text = await readPublicText(`${base}/${MANIFEST_PATH}?t=${deps.now()}`, deps.fetch);
  const manifest = text === null ? null : parseManifest(text);
  if (manifest === null) return null;
  if (held && held.updatedAt === manifest.updated_at) {
    held.at = deps.now();
    return held.site;
  }
  const site = loadSite({
    root: "",
    env: {},
    files: storeFiles(base, manifest, deps.fetch),
    warn: (message) => deps.log?.(message),
  });
  held = { at: deps.now(), updatedAt: manifest.updated_at, site };
  // A failed load is not kept, so the next request tries again.
  site.catch(() => {
    if (held?.site === site) held = null;
  });
  return site;
}
