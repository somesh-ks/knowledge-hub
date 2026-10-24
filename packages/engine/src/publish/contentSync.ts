import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BlobClient } from "./blob.js";
import { publishEpisodeIndex } from "./episodeIndex.js";

/**
 * The content store (D173): the site's content, mirrored from the repository into Vercel Blob under
 * content/<repository path>, so the site can read it at run time and a data commit never needs a
 * deploy. Git stays the backup. A sync compares the files with the store's manifest (each path and
 * its SHA-256), uploads what changed, deletes what is gone and writes the manifest last, so a sync
 * that dies half way is finished by the next one.
 */

export const CONTENT_PREFIX = "content/";
export const CONTENT_MANIFEST_KEY = `${CONTENT_PREFIX}manifest.json`;
export const CONTENT_MANIFEST_VERSION = 1;

/** The folders and files the pages are built from today, settings aside (those are in Neon, D149). */
export const CONTENT_DIRS = ["Digests", "Podcasts"] as const;
export const CONTENT_FILES = [
  "state/last-run.json",
  "state/source-stats.json",
  "state/source-candidates.json",
] as const;

/** Short, as for the episode index: readers add a fresh query string to see a rewrite at once. */
export const CONTENT_CACHE_SECONDS = 60;

const DELETE_BATCH = 50;

export interface ContentManifest {
  version: typeof CONTENT_MANIFEST_VERSION;
  updated_at: string;
  /** Repository path to the SHA-256 of its bytes, in hex. */
  files: Record<string, string>;
}

export interface ContentSyncResult {
  uploaded: string[];
  deleted: string[];
  unchanged: number;
}

async function filesUnder(root: string, dir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Every content file in the checkout, by repository path, with its bytes. */
export async function readContentFiles(root: string): Promise<Map<string, Uint8Array>> {
  const paths = [
    ...(await Promise.all(CONTENT_DIRS.map((dir) => filesUnder(root, dir)))).flat(),
    ...CONTENT_FILES,
  ];
  const files = new Map<string, Uint8Array>();
  for (const path of paths.sort()) {
    try {
      files.set(path, new Uint8Array(await readFile(join(root, path))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

const sha256 = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");

function contentType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

/** The manifest the store holds, or an empty one when there is none or it does not read. */
export async function readStoredManifest(
  client: BlobClient,
  fetchText: (url: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const page = await client.list({ prefix: CONTENT_MANIFEST_KEY });
  const item = page.blobs.find((blob) => blob.pathname === CONTENT_MANIFEST_KEY);
  if (!item) return {};
  // A fresh query string, so the CDN's copy of an older manifest is never read.
  const text = await fetchText(`${item.url}?t=${Date.now()}`);
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text) as Partial<ContentManifest>;
    return parsed.version === CONTENT_MANIFEST_VERSION && parsed.files ? parsed.files : {};
  } catch {
    return {};
  }
}

export interface SyncContentInput {
  client: BlobClient;
  root: string;
  now: Date;
  fetchText: (url: string) => Promise<string | null>;
}

export async function syncContent(input: SyncContentInput): Promise<ContentSyncResult> {
  const { client, root, now } = input;
  const stored = await readStoredManifest(client, input.fetchText);
  const files = await readContentFiles(root);
  const manifest: ContentManifest = {
    version: CONTENT_MANIFEST_VERSION,
    updated_at: now.toISOString(),
    files: {},
  };
  const uploaded: string[] = [];
  for (const [path, body] of files) {
    const hash = sha256(body);
    manifest.files[path] = hash;
    if (stored[path] === hash) continue;
    await client.put(`${CONTENT_PREFIX}${path}`, body, {
      contentType: contentType(path),
      cacheControlMaxAge: CONTENT_CACHE_SECONDS,
    });
    uploaded.push(path);
  }
  const deleted = Object.keys(stored).filter((path) => !files.has(path));
  for (let index = 0; index < deleted.length; index += DELETE_BATCH) {
    await client.del(
      deleted.slice(index, index + DELETE_BATCH).map((p) => `${CONTENT_PREFIX}${p}`),
    );
  }
  if (
    uploaded.some((p) => p.startsWith("Podcasts/")) ||
    deleted.some((p) => p.startsWith("Podcasts/"))
  ) {
    await publishEpisodeIndex(client, root, now);
  }
  // Last: a sync that stops before here leaves the old manifest, so the next one redoes the work.
  await client.put(CONTENT_MANIFEST_KEY, new TextEncoder().encode(JSON.stringify(manifest)), {
    contentType: "application/json",
    cacheControlMaxAge: CONTENT_CACHE_SECONDS,
  });
  return { uploaded, deleted, unchanged: files.size - uploaded.length };
}
