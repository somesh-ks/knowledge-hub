import { readConfigDocuments } from "./configDocs.js";
import { CONFIG_DOCUMENT_PATHS, type ConfigDocument, type SqlClient } from "./configPaths.js";

/**
 * A copy of the config store for a bad day (D300). The owner's config is in no git history any more
 * (D296), so Neon's own point-in-time window is the only other copy; a weekly snapshot in a private
 * Blob store lasts longer than that and survives the database. One JSON file holds every row's exact
 * text, so a restore is a rewrite of rows and needs nothing else.
 */

export const SNAPSHOT_PREFIX = "config-snapshots/";
export const SNAPSHOT_VERSION = 1;

/** Snapshots kept after a new one lands: eight weeks. */
export const SNAPSHOTS_KEEP = 8;

export interface ConfigSnapshot {
  version: typeof SNAPSHOT_VERSION;
  taken_at: string;
  documents: Array<{ path: string; content: string; version: number }>;
}

/** `config-snapshots/2026-11-01.json`: one a day at most, so a rerun the same day replaces it. */
export function snapshotKey(now: Date): string {
  return `${SNAPSHOT_PREFIX}${now.toISOString().slice(0, 10)}.json`;
}

const KEY_PATTERN = /^config-snapshots\/\d{4}-\d{2}-\d{2}\.json$/;

export function buildSnapshot(documents: readonly ConfigDocument[], now: Date): ConfigSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    taken_at: now.toISOString(),
    documents: documents
      .map(({ path, content, version }) => ({ path, content, version }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function serializeSnapshot(snapshot: ConfigSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Read a snapshot file, or throw saying why it cannot be trusted. Only known config paths pass. */
export function parseSnapshot(text: string): ConfigSnapshot {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("the snapshot is not JSON");
  }
  const file = json as Partial<ConfigSnapshot> | null;
  if (file?.version !== SNAPSHOT_VERSION || !Array.isArray(file.documents)) {
    throw new Error("the snapshot is not a version 1 config snapshot");
  }
  const known: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);
  for (const document of file.documents) {
    const row = document as Partial<ConfigSnapshot["documents"][number]> | null;
    if (typeof row?.path !== "string" || typeof row.content !== "string") {
      throw new Error("a snapshot document lacks its path or content");
    }
    if (!known.has(row.path))
      throw new Error(`the snapshot names a path that is not config: ${row.path}`);
  }
  return {
    version: SNAPSHOT_VERSION,
    taken_at: typeof file.taken_at === "string" ? file.taken_at : "",
    documents: file.documents.map(({ path, content, version }) => ({
      path,
      content,
      version: typeof version === "number" ? version : 1,
    })),
  };
}

/** What a snapshot needs from a private store: write and read an object, list and drop old ones. */
export interface SnapshotStore {
  put(key: string, text: string): Promise<void>;
  read(key: string): Promise<string | null>;
  keys(): Promise<string[]>;
  del(keys: readonly string[]): Promise<void>;
}

export interface TakeSnapshotResult {
  key: string;
  documents: number;
  pruned: string[];
}

/**
 * Write today's snapshot, then drop all but the newest `keep`. An empty store is not snapshotted:
 * a copy of nothing would push a good one out of the window.
 */
export async function takeSnapshot(input: {
  sql: SqlClient;
  store: SnapshotStore;
  now: Date;
  keep?: number;
}): Promise<TakeSnapshotResult> {
  const documents = await readConfigDocuments(input.sql);
  if (documents.length === 0) throw new Error("the config store holds no documents to snapshot");
  const key = snapshotKey(input.now);
  await input.store.put(key, serializeSnapshot(buildSnapshot(documents, input.now)));
  const keep = input.keep ?? SNAPSHOTS_KEEP;
  const old = (await input.store.keys())
    .filter((name) => KEY_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(keep);
  if (old.length > 0) await input.store.del(old);
  return { key, documents: documents.length, pruned: old };
}

/**
 * Put a snapshot's rows back, each as a new version so a page that holds an older one is told to
 * reload. Returns the paths written. A row already equal to the snapshot is left alone.
 */
export async function restoreDocuments(
  sql: SqlClient,
  snapshot: ConfigSnapshot,
): Promise<string[]> {
  const written: string[] = [];
  for (const document of snapshot.documents) {
    const rows = await sql.query(
      `insert into config_documents (path, content) values ($1, $2)
       on conflict (path) do update set content = excluded.content,
         version = config_documents.version + 1, updated_at = now()
       where config_documents.content is distinct from excluded.content returning path`,
      [document.path, document.content],
    );
    if (rows.length > 0) written.push(document.path);
  }
  return written;
}
