import { dangerouslyDeleteByTag, waitUntil } from "@vercel/functions";
import type { ContentFiles } from "../lib/contentFiles";
import { loadSite, readSiteFrom, type Site } from "../lib/site";
import { type BlobFetch, readPublicText } from "./blobStore";
import { bundledContentFiles } from "./bundledFiles";
import { readPublicBlobBase, type ServerEnv } from "./config";
import { readTombstones, withoutTombstoned } from "./tombstones";

/**
 * The content repository (D173): the one place a page rendered on request gets its content. Today
 * it reads the content store in Blob, which `singularity content sync` fills from git
 * (content/<repository path>, listed by content/manifest.json). With many users it reads Postgres
 * instead, one row per user, and no page changes.
 *
 * Blob budget: the manifest is read fresh (one SIMPLE operation) at most once per MANIFEST_TTL_MS
 * per function instance; every file is read by a URL that names its hash, so the CDN serves each
 * version from cache after its first read, for free.
 */

export const MANIFEST_TTL_MS = 30_000;

/**
 * How long Vercel's edge keeps a page rendered from the repository: five minutes fresh, then served
 * at once while one request renders it again, for 30 days (D318). With a ten-minute window, 43% of
 * the owner's page loads in a week (to 2026-11-01) missed the Stockholm edge and waited on the
 * function in Washington. Freshness comes from the purge by CONTENT_CACHE_TAG when the content
 * changes, not from the lifetime: a purge that fails costs one stale visit after five minutes.
 * Browsers are not told to keep it (vercel.json's no-cache stands), so a reload always asks the edge.
 */
export const CONTENT_CDN_CACHE = "max-age=300, stale-while-revalidate=2592000";

/**
 * The tag on every page drawn from the content (D318). Each content change deletes the edge's copies
 * by it: `content.yml` after every sync, and purgeContentAtEdge when a delete writes a tombstone.
 */
export const CONTENT_CACHE_TAG = "content";

/** Lets the edge keep a page drawn from the content until the content changes (D318). */
export function keepAtEdge(headers: Headers): void {
  headers.set("Vercel-CDN-Cache-Control", CONTENT_CDN_CACHE);
  headers.set("Vercel-Cache-Tag", CONTENT_CACHE_TAG);
}

/**
 * Deletes the edge's copies of every content page. Delete, not invalidate: an invalidated page is
 * answered once more from its old copy, which would show a deleted episode again. Every instance
 * holds the manifest and the tombstones for MANIFEST_TTL_MS, so a request inside that window can put
 * the old page back; a second delete after the window removes it. Outside Vercel both do nothing,
 * and neither ever fails the caller.
 */
export function purgeContentAtEdge(): Promise<void> {
  const remove = () => dangerouslyDeleteByTag(CONTENT_CACHE_TAG).catch(() => undefined);
  const again = new Promise((resolve) => setTimeout(resolve, MANIFEST_TTL_MS + 5_000)).then(remove);
  try {
    waitUntil(again);
  } catch {
    // Not on Vercel: the timer runs on its own.
  }
  return remove();
}
const MANIFEST_PATH = "content/manifest.json";
/** Files a page can do without: the reader that asks for one handles its absence. */
const OPTIONAL_STATE: ReadonlySet<string> = new Set(["state/last-run.json"]);

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
  /** The settings store's schedule text, for tests; the store's own reader otherwise. */
  readStoredSchedule?: (storeUrl: string) => Promise<string | null>;
}

let heldManifest: { at: number; base: string; manifest: Manifest } | null = null;
let heldTombstones: { at: number; ids: Promise<ReadonlySet<string>> } | null = null;
let heldSite: { updatedAt: string; site: Promise<Site> } | null = null;

/** Forget what this instance holds. For tests. */
export function resetContentRepo(): void {
  heldManifest = null;
  heldSite = null;
  heldTombstones = null;
  heldBundled = null;
  inFlightCheck = null;
  storeFailedAt = Number.NEGATIVE_INFINITY;
  savedContent = false;
}

/**
 * Makes the next read fetch the manifest, however recently it was read. The held site stays: it is
 * reloaded only if the store's manifest has changed, so this costs one small read, not a reload.
 * For a request that names content this instance may not have seen yet (a cover, D258).
 */
export function expireContentManifest(): void {
  if (heldManifest) heldManifest = { ...heldManifest, at: Number.NEGATIVE_INFINITY };
}

/** Deleted episodes the manifest may still list (tombstones.ts), read at most once per window. */
function currentTombstones(base: string, deps: ContentRepoDeps): Promise<ReadonlySet<string>> {
  if (heldTombstones && deps.now() - heldTombstones.at < MANIFEST_TTL_MS) return heldTombstones.ids;
  heldTombstones = { at: deps.now(), ids: readTombstones(base, deps.fetch, deps.now()) };
  return heldTombstones.ids;
}

/** The store's manifest, read fresh at most once per MANIFEST_TTL_MS. Null when there is none. */
async function currentManifest(
  deps: ContentRepoDeps,
): Promise<{ base: string; manifest: Manifest; saved: boolean } | null> {
  if (heldManifest && deps.now() - heldManifest.at < MANIFEST_TTL_MS)
    return { ...heldManifest, saved: savedContent };
  const base = readPublicBlobBase(deps.env);
  if (base === null) return null;
  try {
    // `t` is never used by the store; it makes a URL the CDN has not cached.
    const text = await readPublicText(`${base}/${MANIFEST_PATH}?t=${deps.now()}`, deps.fetch);
    const manifest = text === null ? null : parseManifest(text);
    if (manifest === null) throw new Error("the content store has no manifest");
    heldManifest = { at: deps.now(), base, manifest };
    savedContent = false;
    return { ...heldManifest, saved: false };
  } catch (error) {
    // Unreachable: the last manifest this instance read still answers, and pages say so (criterion
    // 9). An instance that never read one has nothing to show.
    if (heldManifest === null) {
      if (error instanceof Error && error.message === "the content store has no manifest")
        return null;
      throw error;
    }
    savedContent = true;
    // The next read waits a window, so an outage does not make every request wait on the dead store.
    heldManifest = { ...heldManifest, at: deps.now() };
    return { ...heldManifest, saved: true };
  }
}

let savedContent = false;

/** True while pages are drawn from the last manifest read, because the store could not be reached. */
export function isShowingSavedContent(): boolean {
  return savedContent;
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
  return (await loadStoreSiteChecked(deps))?.site ?? null;
}

/**
 * loadStoreSite with whether the site is the last one this instance read because the store could
 * not be reached, taken from this load itself, not from state another request may change.
 */
export async function loadStoreSiteChecked(
  deps: ContentRepoDeps,
): Promise<{ site: Site; saved: boolean } | null> {
  const current = await currentManifest(deps);
  if (current === null) return null;
  const ids = await currentTombstones(current.base, deps);
  const { saved } = current;
  if (heldSite?.updatedAt === current.manifest.updated_at)
    return { site: await heldSite.site.then((site) => withoutTombstoned(site, ids)), saved };
  const files = storeFiles(current.base, current.manifest, deps.fetch);
  let failed: unknown = null;
  const site = loadSite({
    root: "",
    env: {},
    // The readers skip a file they cannot read, so an unreadable object would leave a gap in the
    // site, not an error. Count it here and fail the load, so the caller shows this build's copy.
    files: {
      list: (directory) => files.list(directory),
      // After the first failure the store is treated as down: no further object requests, so a
      // string of slow reads cannot outlast the function before the fallback starts.
      read: (path) => {
        if (failed !== null) return Promise.reject(failed);
        return files.read(path).catch((error: unknown) => {
          // Run state is optional: its reader answers "no run known" for a file it cannot read, so
          // a failure there says nothing about the content.
          if (!OPTIONAL_STATE.has(path)) failed ??= error;
          throw error;
        });
      },
    },
    warn: (message) => deps.log?.(message),
  }).then((loaded) => {
    if (failed !== null)
      throw new Error(
        `content store read failed: ${failed instanceof Error ? failed.message : "unknown"}`,
      );
    return loaded;
  });
  const previous = heldSite;
  heldSite = { updatedAt: current.manifest.updated_at, site };
  // A failed load is not kept, so the next request tries again; the site held before it stays.
  site.catch(() => {
    if (heldSite?.site === site) heldSite = previous;
  });
  try {
    return { site: await site.then((loaded) => withoutTombstoned(loaded, ids)), saved };
  } catch (error) {
    // The newer content could not be read: the last site this instance loaded is fresher than the
    // build's copy, and says it is saved.
    if (previous === null) throw error;
    const held = await previous.site
      .then((loaded) => withoutTombstoned(loaded, ids))
      .catch(() => null);
    if (held === null) throw error;
    savedContent = true;
    return { site: held, saved: true };
  }
}

/** When the store last failed with nothing held, so an outage costs one slow read a window, not one per request. */
let storeFailedAt = Number.NEGATIVE_INFINITY;
let heldBundled: Promise<Site> | null = null;
let inFlightCheck: Promise<{ site: Site; saved: boolean } | null> | null = null;

/**
 * The page's site: the store's when it answers; otherwise this build's own copy, flagged as saved so
 * the page says so. A cold instance (no manifest ever read) used to answer 503 when the store was
 * blocked, which is how the site went down on 2026-10-30; an instance that had read the manifest
 * already kept its last one. Deleted episodes the instance has not seen tombstones for can reappear
 * until the store answers (D282).
 */
export async function loadPageSite(
  deps: ContentRepoDeps,
  bundled: ContentFiles = bundledContentFiles,
): Promise<{ site: Site; saved: boolean }> {
  if (deps.now() - storeFailedAt >= MANIFEST_TTL_MS) {
    // One attempt for every request that arrives while it runs, not one slow read each.
    inFlightCheck ??= (async () => {
      try {
        const checked = await loadStoreSiteChecked(deps);
        if (checked) return checked;
      } catch (error) {
        deps.log?.(
          `content store unavailable: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      storeFailedAt = deps.now();
      return null;
    })().finally(() => {
      inFlightCheck = null;
    });
    const checked = await inFlightCheck;
    if (checked) return checked;
  }
  heldBundled ??= loadSite({
    root: "",
    env: {},
    files: bundled,
    warn: (message) => deps.log?.(message),
  });
  heldBundled.catch(() => {
    heldBundled = null;
  });
  const ids = await heldTombstones?.ids.catch(() => new Set<string>());
  const site = await heldBundled;
  // With no store configured the build's copy is simply the content, not a saved copy of anything.
  const saved = readPublicBlobBase(deps.env) !== null;
  if (saved) savedContent = true;
  return { site: ids ? withoutTombstoned(site, ids) : site, saved };
}

/**
 * The guard every page rendered on request starts with: point getSite() at the content (the
 * store's, or this build's copy when the store cannot answer), so the page and every component it
 * draws read the same content. A page then reads `await getSite()` as a built page does. Answers
 * 503 only when neither the store nor the build has any content to show.
 */
export async function readFromContentRepo(label: string): Promise<Response | null> {
  const load = async (): Promise<Site> => {
    const { site } = await loadPageSite({
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[${label}] ${message}`),
    });
    return site;
  };
  try {
    await load();
  } catch (error) {
    console.error(
      `[${label}] no content to show: ${error instanceof Error ? error.message : "unknown"}`,
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
  // The edge answers /404 with the page and status 404, so the status is not a failure here.
  const notFound = await fetch(new URL("/404", pageUrl)).catch(() => null);
  const page = notFound?.ok || notFound?.status === 404 ? await notFound.text() : "Not found";
  return new Response(page, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
