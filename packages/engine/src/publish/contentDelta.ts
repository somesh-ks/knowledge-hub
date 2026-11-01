import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ConditionalBlobClient, isPreconditionFailed } from "./blob.js";
import {
  CONTENT_CACHE_SECONDS,
  CONTENT_DIRS,
  CONTENT_FILES,
  CONTENT_MANIFEST_KEY,
  CONTENT_MANIFEST_VERSION,
  CONTENT_PREFIX,
  COST_LEDGER,
  type ContentManifest,
  contentType,
  sha256,
} from "./contentSync.js";
import { indexFromTexts, isEpisodePath, uploadEpisodeIndex } from "./episodeIndex.js";

/**
 * Changing the content store one file at a time (D300). `syncContent` mirrors a whole checkout and
 * deletes what the checkout lacks, which is safe only while git holds everything. Once the store is
 * the source of truth a job holds a few files, so it names them: put these, remove those, and every
 * other path stays as it is. Two jobs may do this at once, so the manifest is written with the ETag
 * it was read at (Blob refuses the write if another job changed it first) and the change is made
 * again on top of what that job wrote.
 *
 * Bound: one writer per path. A blob's key is its path, so two jobs that put different bytes to the
 * same path at once can leave the blob of one under the hash of the other. The pipeline has one
 * writer for each path (a digest, an episode, a state file), so this guards the manifest, which they
 * share, and not a path they do not.
 */

/** Attempts at the manifest before giving up: each failure means another job wrote it meanwhile. */
export const DELTA_ATTEMPTS = 6;

/** A path the content store may hold: under Digests/ or Podcasts/, a listed file or a cost ledger. */
export function isContentPath(path: string): boolean {
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
  return (
    CONTENT_DIRS.some((dir) => path.startsWith(`${dir}/`)) ||
    (CONTENT_FILES as readonly string[]).includes(path) ||
    COST_LEDGER.test(path)
  );
}

export interface StoredManifest {
  /** The manifest blob's ETag, or null when the store has none yet. */
  etag: string | null;
  /** The store's public URL for a content path's folder, ending without a slash. */
  base: string | null;
  files: Record<string, string>;
}

/** The manifest and the ETag to write it back against; empty when the store has none. */
export async function readManifest(
  client: ConditionalBlobClient,
  fetchText: (url: string) => Promise<string | null>,
): Promise<StoredManifest> {
  const found = await client.head(CONTENT_MANIFEST_KEY);
  if (found === null) return { etag: null, base: null, files: {} };
  // A fresh query string, so the CDN's copy of an older manifest is never read.
  const text = await fetchText(`${found.url}?t=${Date.now()}`);
  const base = found.url.slice(0, found.url.length - CONTENT_MANIFEST_KEY.length - 1);
  if (text === null) throw new Error("the content store lists a manifest it cannot read");
  const parsed = JSON.parse(text) as Partial<ContentManifest>;
  if (parsed.version !== CONTENT_MANIFEST_VERSION || !parsed.files) {
    throw new Error("the content store's manifest is not version 1");
  }
  return { etag: found.etag, base, files: parsed.files };
}

export interface DeltaInput {
  client: ConditionalBlobClient;
  root: string;
  now: Date;
  fetchText: (url: string) => Promise<string | null>;
  put: readonly string[];
  remove: readonly string[];
  attempts?: number;
}

export interface DeltaResult {
  uploaded: string[];
  removed: string[];
  unchanged: string[];
  attempts: number;
}

const PODCASTS = "Podcasts/";

/**
 * Rebuild the episode index from the episodes the manifest lists, not from this checkout: a job that
 * holds one new episode must not publish an index of one. An episode this checkout has, with the
 * manifest's hash, is read from disk; the others are fetched from the store.
 */
async function publishIndexFromStore(
  client: ConditionalBlobClient,
  root: string,
  now: Date,
  base: string,
  files: Readonly<Record<string, string>>,
  fetchText: (url: string) => Promise<string | null>,
): Promise<void> {
  const texts: Array<[string, string | null]> = [];
  for (const path of Object.keys(files).filter(isEpisodePath).sort()) {
    const local = await readFile(join(root, path)).catch(() => null);
    if (local !== null && sha256(new Uint8Array(local)) === files[path]) {
      texts.push([path, local.toString("utf8")]);
    } else {
      texts.push([path, await fetchText(`${base}/${CONTENT_PREFIX}${path}?t=${Date.now()}`)]);
    }
  }
  await uploadEpisodeIndex(client, indexFromTexts(texts, now));
}

export async function applyContentDelta(input: DeltaInput): Promise<DeltaResult> {
  const { client, root, now } = input;
  for (const path of [...input.put, ...input.remove]) {
    if (!isContentPath(path)) throw new Error(`not a content path: ${path}`);
  }
  const overlap = input.put.filter((path) => input.remove.includes(path));
  if (overlap.length > 0) throw new Error(`named to put and to remove: ${overlap.join(", ")}`);

  const bodies = new Map<string, { body: Uint8Array; hash: string }>();
  for (const path of input.put) {
    const body = new Uint8Array(await readFile(join(root, path)));
    bodies.set(path, { body, hash: sha256(body) });
  }

  const touchesPodcasts = [...input.put, ...input.remove].some((path) => path.startsWith(PODCASTS));
  const limit = input.attempts ?? DELTA_ATTEMPTS;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const stored = await readManifest(client, input.fetchText);
    const files = { ...stored.files };
    const uploaded: string[] = [];
    const unchanged: string[] = [];
    for (const [path, { body, hash }] of bodies) {
      if (files[path] === hash) {
        unchanged.push(path);
        continue;
      }
      await client.put(`${CONTENT_PREFIX}${path}`, body, {
        contentType: contentType(path),
        cacheControlMaxAge: CONTENT_CACHE_SECONDS,
      });
      files[path] = hash;
      uploaded.push(path);
    }
    const removed = input.remove.filter((path) => path in files);
    for (const path of removed) delete files[path];

    if (uploaded.length === 0 && removed.length === 0) {
      // A run that died after the manifest but before the index is repeated with nothing changed:
      // the index is rebuilt anyway, so that run's missing write is made good here.
      if (touchesPodcasts && stored.base !== null) {
        await publishIndexFromStore(client, root, now, stored.base, files, input.fetchText);
      }
      return { uploaded, removed, unchanged, attempts: attempt };
    }
    const manifest: ContentManifest = {
      version: CONTENT_MANIFEST_VERSION,
      updated_at: now.toISOString(),
      files,
    };
    let written: { url: string };
    try {
      written = await client.put(
        CONTENT_MANIFEST_KEY,
        new TextEncoder().encode(JSON.stringify(manifest)),
        {
          contentType: "application/json",
          cacheControlMaxAge: CONTENT_CACHE_SECONDS,
          ...(stored.etag !== null ? { ifMatch: stored.etag } : {}),
        },
      );
    } catch (error) {
      if (isPreconditionFailed(error) && attempt < limit) continue;
      throw error;
    }
    const base = written.url.slice(0, written.url.length - CONTENT_MANIFEST_KEY.length - 1);
    let current: Readonly<Record<string, string>> = files;
    if (removed.length > 0) {
      // After the manifest: a reader stops listing a path before its blob goes. A job that put the
      // path back since keeps its blob, so only paths the manifest still lacks are deleted.
      current = (await readManifest(client, input.fetchText)).files;
      const gone = removed.filter((path) => !(path in current));
      if (gone.length > 0) await client.del(gone.map((path) => `${CONTENT_PREFIX}${path}`));
    }
    if (touchesPodcasts) {
      await publishIndexFromStore(client, root, now, base, current, input.fetchText);
    }
    return { uploaded, removed, unchanged, attempts: attempt };
  }
  throw new Error("the content manifest kept changing under this write");
}
