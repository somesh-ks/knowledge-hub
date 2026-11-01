import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConditionalBlobClient } from "./blob.js";
import { applyContentDelta, type DeltaResult } from "./contentDelta.js";
import { fetchBytes } from "./contentFetch.js";
import { type PullResult, pullContent } from "./contentPull.js";
import { CONTENT_DIRS, readContentFiles, sha256 } from "./contentSync.js";

/**
 * Digests and episodes live in the content store, not in git (D300 step 2b). A job that reads or
 * writes them works on a checkout it filled from the store:
 *
 *   1. `content pull` copies Digests/ and Podcasts/ in and records what the store held (the baseline).
 *   2. The job reads and writes those files as it always did; git ignores them.
 *   3. After its git commit succeeded, `content push` compares the checkout with the baseline and
 *      sends only what this job changed: files it added or rewrote are put, files it deleted are
 *      removed, and every other path stays as it is, so two jobs that ran at once never undo each
 *      other. The store is written after git, so a commit that failed leaves the store as it was.
 *
 * The baseline file is also the switch: a checkout that never pulled has none and cannot push, so a
 * run on a developer's machine leaves the store alone. The small state files the site reads
 * (CONTENT_FILES) are still in git, so git stays their authority: push copies them over.
 */

/** Gitignored with the rest of .cache/. */
export const BASELINE_PATH = ".cache/content-baseline.json";
const BASELINE_VERSION = 1;

interface Baseline {
  version: typeof BASELINE_VERSION;
  files: Record<string, string>;
}

const inWorkspace = (path: string): boolean =>
  CONTENT_DIRS.some((dir) => path.startsWith(`${dir}/`));

async function readBaseline(root: string): Promise<Baseline | null> {
  const text = await readFile(join(root, BASELINE_PATH), "utf8").catch(() => null);
  if (text === null) return null;
  const parsed = JSON.parse(text) as Partial<Baseline>;
  if (parsed.version !== BASELINE_VERSION || parsed.files === undefined) {
    throw new Error(`${BASELINE_PATH} is not a version ${BASELINE_VERSION} baseline`);
  }
  return { version: BASELINE_VERSION, files: parsed.files };
}

async function writeBaseline(root: string, files: Record<string, string>): Promise<void> {
  const path = join(root, BASELINE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: BASELINE_VERSION, files }), "utf8");
}

export interface WorkspaceInput {
  client: ConditionalBlobClient;
  root: string;
  now: Date;
  fetchText: (url: string) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
}

/** Fill Digests/ and Podcasts/ from the store and remember what the store held. */
export async function pullWorkspace(input: WorkspaceInput): Promise<PullResult> {
  const result = await pullContent({
    client: input.client,
    root: input.root,
    fetchText: input.fetchText,
    fetchBytes: input.fetchBytes ?? fetchBytes,
    only: [...CONTENT_DIRS],
  });
  await writeBaseline(input.root, result.listed);
  return result;
}

/**
 * Send this checkout's changes to the store. Null when the checkout never pulled (nothing to do).
 * The state files in CONTENT_FILES go too: the delta skips any whose hash the store already has.
 */
export async function pushWorkspace(input: WorkspaceInput): Promise<DeltaResult | null> {
  const baseline = await readBaseline(input.root);
  if (baseline === null) return null;
  const local = await readContentFiles(input.root);
  const hashes: Record<string, string> = {};
  const put: string[] = [];
  for (const [path, body] of local) {
    const hash = sha256(body);
    if (!inWorkspace(path)) {
      put.push(path);
      continue;
    }
    hashes[path] = hash;
    if (baseline.files[path] !== hash) put.push(path);
  }
  const remove = Object.keys(baseline.files).filter((path) => !(path in hashes));
  const result = await applyContentDelta({
    client: input.client,
    root: input.root,
    now: input.now,
    fetchText: input.fetchText,
    put,
    remove,
  });
  // A second push in the same job sends only what changed since this one.
  await writeBaseline(input.root, hashes);
  return result;
}
