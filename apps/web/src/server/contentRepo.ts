import type { ContentFiles } from "../lib/contentFiles";
import { loadSite, readSiteFrom, type Site } from "../lib/site";
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

let heldManifest: { at: number; base: string; manifest: Manifest } | null = null;
let heldSite: { updatedAt: string; site: Promise<Site> } | null = null;

/** Forget what this instance holds. For tests. */
export function resetContentRepo(): void {
  heldManifest = null;
  heldSite = null;
}

/** The store's manifest, read fresh at most once per MANIFEST_TTL_MS. Null when there is none. */
async function currentManifest(
  deps: ContentRepoDeps,
): Promise<{ base: string; manifest: Manifest } | null> {
  if (heldManifest && deps.now() - heldManifest.at < MANIFEST_TTL_MS) return heldManifest;
  const base = readPublicBlobBase(deps.env);
  if (base === null) return null;
  // `t` is never used by the store; it makes a URL the CDN has not cached.
  const text = await readPublicText(`${base}/${MANIFEST_PATH}?t=${deps.now()}`, deps.fetch);
  const manifest = text === null ? null : parseManifest(text);
  if (manifest === null) return null;
  heldManifest = { at: deps.now(), base, manifest };
  return heldManifest;
}

/** The store's files by repository path, or null when the store is not configured or empty. */
export async function loadStoreFiles(deps: ContentRepoDeps): Promise<ContentFiles | null> {
  const current = await currentManifest(deps);
  return current && storeFiles(current.base, current.manifest, deps.fetch);
}

/**
 * The site's content from the store: newest first, parsed by the same readers as the build. Null
 * when the store is not configured or has no manifest, so the caller can answer "unavailable".
 */
export async function loadStoreSite(deps: ContentRepoDeps): Promise<Site | null> {
  const current = await currentManifest(deps);
  if (current === null) return null;
  if (heldSite?.updatedAt === current.manifest.updated_at) return heldSite.site;
  const site = loadSite({
    root: "",
    env: {},
    files: storeFiles(current.base, current.manifest, deps.fetch),
    warn: (message) => deps.log?.(message),
  });
  heldSite = { updatedAt: current.manifest.updated_at, site };
  // A failed load is not kept, so the next request tries again.
  site.catch(() => {
    if (heldSite?.site === site) heldSite = null;
  });
  return site;
}

/**
 * The guard every page rendered on request starts with: point getSite() at the repository (so the
 * page and every component it draws read the same content), or answer 503 when the store does not.
 * A page then reads `await getSite()` as a built page does.
 */
export async function readFromContentRepo(label: string): Promise<Response | null> {
  const load = async (): Promise<Site> => {
    const site = await loadStoreSite({
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[${label}] ${message}`),
    });
    if (site === null) throw new Error("the content store has no manifest");
    return site;
  };
  try {
    await load();
  } catch (error) {
    console.error(
      `[${label}] content store unavailable: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return new Response("This page could not be loaded right now. Try again in a minute.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" },
    });
  }
  readSiteFrom(load);
  return null;
}

/**
 * The site's 404 for an id the repository does not hold. The 404 page is built, not part of this
 * function, so it is fetched from the site's own edge.
 */
export async function notFoundPage(pageUrl: URL): Promise<Response> {
  const notFound = await fetch(new URL("/404", pageUrl)).catch(() => null);
  return new Response(notFound?.ok ? await notFound.text() : "Not found", {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
