import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../state/atomicWrite.js";
import {
  type ConditionalBlobClient,
  CURRENT_POLL_MS,
  CURRENT_WAIT_MS,
  type StoreClock,
  systemClock,
} from "./blob.js";
import { isContentPath, readManifest } from "./contentDelta.js";
import { CONTENT_PREFIX, sha256 } from "./contentSync.js";

/**
 * Copy the content store's files into a checkout (D300), so a job that reads `Digests/` finds it
 * once git no longer holds it. Every file is checked against the manifest's hash before it is
 * written: a stale CDN copy or a half-written object stops the pull instead of landing as a digest.
 * Nothing is deleted: a pull only adds and replaces, so a file the store lacks is left where it is.
 */

export interface PullInput {
  client: ConditionalBlobClient;
  root: string;
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  /** Folders or files to pull, as repository paths ("Digests", "state/last-run.json"). */
  only: readonly string[];
  clock?: StoreClock;
}

export interface PullResult {
  written: string[];
  unchanged: number;
  /** Every wanted path the manifest lists, with its hash: what this checkout now holds of the store. */
  listed: Record<string, string>;
}

const wanted = (path: string, only: readonly string[]): boolean =>
  only.some((item) => path === item || path.startsWith(`${item.replace(/\/$/, "")}/`));

export async function pullContent(input: PullInput): Promise<PullResult> {
  const stored = await readManifest(input.client);
  if (stored.base === null) throw new Error("the content store has no manifest to pull");
  const written: string[] = [];
  const listed: Record<string, string> = {};
  let unchanged = 0;
  for (const [path, hash] of Object.entries(stored.files).sort()) {
    if (!isContentPath(path) || !wanted(path, input.only)) continue;
    listed[path] = hash;
    const local = await readFile(join(input.root, path)).catch(() => null);
    if (local !== null && sha256(new Uint8Array(local)) === hash) {
      unchanged += 1;
      continue;
    }
    const url = `${stored.base}/${CONTENT_PREFIX}${path.split("/").map(encodeURIComponent).join("/")}?v=${hash}`;
    // A file rewritten within the last minute can still answer with its old copy (readCurrent):
    // wait for the bytes the manifest names before calling the store damaged.
    const clock = input.clock ?? systemClock;
    const deadline = clock.now() + CURRENT_WAIT_MS;
    let body = await input.fetchBytes(url);
    while ((body === null || sha256(body) !== hash) && clock.now() < deadline) {
      await clock.pause(CURRENT_POLL_MS);
      body = await input.fetchBytes(url);
    }
    if (body === null) throw new Error(`the store lists ${path} but has no such file`);
    if (sha256(body) !== hash)
      throw new Error(`${path} in the store does not match its manifest hash`);
    await writeFileAtomic(join(input.root, path), body);
    written.push(path);
  }
  return { written, unchanged, listed };
}
