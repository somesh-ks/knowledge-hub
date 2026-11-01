import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../state/atomicWrite.js";
import type { ConditionalBlobClient } from "./blob.js";
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
  fetchText: (url: string) => Promise<string | null>;
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  /** Folders or files to pull, as repository paths ("Digests", "state/last-run.json"). */
  only: readonly string[];
}

export interface PullResult {
  written: string[];
  unchanged: number;
}

const wanted = (path: string, only: readonly string[]): boolean =>
  only.some((item) => path === item || path.startsWith(`${item.replace(/\/$/, "")}/`));

export async function pullContent(input: PullInput): Promise<PullResult> {
  const stored = await readManifest(input.client, input.fetchText);
  if (stored.base === null) throw new Error("the content store has no manifest to pull");
  const written: string[] = [];
  let unchanged = 0;
  for (const [path, hash] of Object.entries(stored.files).sort()) {
    if (!isContentPath(path) || !wanted(path, input.only)) continue;
    const local = await readFile(join(input.root, path)).catch(() => null);
    if (local !== null && sha256(new Uint8Array(local)) === hash) {
      unchanged += 1;
      continue;
    }
    const body = await input.fetchBytes(`${stored.base}/${CONTENT_PREFIX}${path}?v=${hash}`);
    if (body === null) throw new Error(`the store lists ${path} but has no such file`);
    if (sha256(body) !== hash)
      throw new Error(`${path} in the store does not match its manifest hash`);
    // Content files are UTF-8 text (markdown and JSON); the hash above proves the bytes are intact.
    await writeFileAtomic(join(input.root, path), Buffer.from(body).toString("utf8"));
    written.push(path);
  }
  return { written, unchanged };
}
