import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { type ConditionalBlobClient, createVercelBlobClient } from "./blob.js";
import { applyContentDelta, type DeltaResult } from "./contentDelta.js";
import { fetchBytes, fetchText } from "./contentFetch.js";
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
 * (CONTENT_FILES) are still in git, so git stays their authority: the baseline holds their hashes
 * at pull time too, and push copies a state file over only if this job changed it, so a slow job
 * never replaces a newer file with the older copy it started from.
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
  // Only a missing file means "never pulled"; any other failure must stop the caller, or a commit
  // would go ahead without its digest being saved.
  const text = await readFile(join(root, BASELINE_PATH), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
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
  await writeFileAtomic(
    path,
    new TextEncoder().encode(JSON.stringify({ version: BASELINE_VERSION, files })),
  );
}

export interface WorkspaceInput {
  client: ConditionalBlobClient;
  root: string;
  now: Date;
  fetchText: (url: string) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
}

/** True when this checkout pulled from the store, so its digests are not tracked by git. */
export async function hasWorkspaceBaseline(root: string): Promise<boolean> {
  return (await readBaseline(root)) !== null;
}

/**
 * Fill Digests/ and Podcasts/ from the store and remember what the store held. A second pull in the
 * same checkout first drops the files the earlier pull brought that the store has since lost (and
 * this job never touched), so a stale copy is not pushed back as if it were new.
 */
export async function pullWorkspace(input: WorkspaceInput): Promise<PullResult> {
  const before = await readBaseline(input.root);
  const result = await pullContent({
    client: input.client,
    root: input.root,
    fetchText: input.fetchText,
    fetchBytes: input.fetchBytes ?? fetchBytes,
    only: [...CONTENT_DIRS],
  });
  for (const [path, hash] of Object.entries(before?.files ?? {})) {
    if (!inWorkspace(path) || path in result.listed) continue;
    const local = await readFile(join(input.root, path)).catch(() => null);
    if (local !== null && sha256(new Uint8Array(local)) === hash) {
      await rm(join(input.root, path), { force: true });
    }
  }
  const files = { ...result.listed };
  for (const [path, body] of await readContentFiles(input.root)) {
    if (!inWorkspace(path)) files[path] = sha256(body);
  }
  await writeBaseline(input.root, files);
  return result;
}

/**
 * Send this checkout's changes to the store. Null when the checkout never pulled (nothing to do).
 * A state file in CONTENT_FILES goes only if this job changed it since the pull.
 */
export async function pushWorkspace(input: WorkspaceInput): Promise<DeltaResult | null> {
  const baseline = await readBaseline(input.root);
  if (baseline === null) return null;
  const local = await readContentFiles(input.root);
  const hashes: Record<string, string> = {};
  const put: string[] = [];
  for (const [path, body] of local) {
    const hash = sha256(body);
    hashes[path] = hash;
    if (baseline.files[path] !== hash) put.push(path);
  }
  const remove = Object.keys(baseline.files).filter(
    (path) => inWorkspace(path) && !(path in hashes),
  );
  // A folder that held pulled content and now holds none either vanished (a clean, a wrong
  // directory), which sent as "delete everything in it" would empty the store of that folder, or
  // lost its last file to a delete, which is a normal request and leaves the folder behind.
  for (const dir of CONTENT_DIRS) {
    const under = (paths: string[]): boolean => paths.some((path) => path.startsWith(`${dir}/`));
    if (!under(Object.keys(baseline.files)) || under(Object.keys(hashes))) continue;
    const there = await stat(join(input.root, dir)).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!there) {
      throw new Error(
        `this checkout pulled ${dir}/ but it is gone now; a push would delete it all from the store`,
      );
    }
  }
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

/**
 * What the run's commit stage calls right before its git commit: the digest reaches the store first,
 * so a store write that fails stops the commit and the run is repeated, rather than git recording a
 * digest the store never received (the gate would then skip the rerun and the digest would be lost).
 * A no-op for a checkout that never pulled.
 */
export function makeContentPublisher(
  env: { BLOB_READ_WRITE_TOKEN?: string | undefined },
  root: string,
  now: () => Date,
): () => Promise<void> {
  return async () => {
    if (!(await hasWorkspaceBaseline(root))) return;
    if (!env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "this checkout pulled its content from the store but BLOB_READ_WRITE_TOKEN is not set, so the digest cannot be saved",
      );
    }
    await pushWorkspace({
      client: createVercelBlobClient(env.BLOB_READ_WRITE_TOKEN),
      root,
      now: now(),
      fetchText,
    });
  };
}
