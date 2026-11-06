import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../context.js";
import { stateMergerFor } from "../git/stateMerge.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { CONFIG_DOCUMENT_PATHS, type SqlClient } from "./configPaths.js";

/**
 * The engine's run state (`state/*.json`) in Postgres (D300 step 3): one row per file, holding the
 * file's exact text and a version. A job copies the rows over the files before it starts (`pullState`)
 * and writes back what it changed when it ends (`pushState`), so the engine keeps reading plain
 * files. This mirrors the config store (configDocs.ts) and the content store's pull and push.
 *
 * A push writes only a file that differs from what the pull left, and only on the version the pull
 * saw. When another job moved the row meanwhile, the file's merger (git/stateMerge.ts) unions the
 * two; a file with no merger (seen, judgments, last-run) is refused, never overwritten, because a
 * lost update there repeats a story or forgets a verdict.
 */

export const STATE_SCHEMA_SQL = `create table if not exists state_documents (
  path text primary key,
  content text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
)`;

/** Where a pull records what it wrote, so a push knows what changed and what each row's version was. */
export const STATE_BASELINE_PATH = ".cache/state-pulled.json";

const STATE_PATH = /^state\/[a-z0-9-]+\.json$/;
const CONFIG_PATHS: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);

/** A file this store may hold. The suggested sources are the config store's (D296), not these. */
export function isStatePath(path: string): boolean {
  return STATE_PATH.test(path) && !CONFIG_PATHS.has(path);
}

/** Attempts to land a merged write before giving up; each loses only to another job's write. */
const PUSH_ATTEMPTS = 4;

export class StateConflictError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`state conflict on ${path}: ${reason}`);
    this.name = "StateConflictError";
  }
}

interface StoredRow {
  path: string;
  content: string;
  version: number;
}

/** What a pull left: each file's row version and text, so a push can tell a change and merge. */
type Baseline = Record<string, { version: number; content: string }>;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readBaseline(root: string): Promise<Baseline> {
  const text = await readText(join(root, STATE_BASELINE_PATH));
  if (text === null) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Baseline)
      : {};
  } catch {
    return {};
  }
}

async function writeBaseline(root: string, baseline: Baseline): Promise<void> {
  await mkdir(join(root, ".cache"), { recursive: true });
  await writeFileAtomic(join(root, STATE_BASELINE_PATH), `${JSON.stringify(baseline)}\n`);
}

async function readRows(sql: SqlClient, paths?: readonly string[]): Promise<StoredRow[]> {
  const rows =
    paths === undefined
      ? await sql.query("select path, content, version from state_documents")
      : await sql.query(
          "select path, content, version from state_documents where path = any($1::text[])",
          [[...paths]],
        );
  return rows
    .map((row) => ({
      path: String(row.path),
      content: String(row.content),
      version: Number(row.version),
    }))
    .filter((row) => isStatePath(row.path));
}

/** The state files in the checkout. */
async function localStatePaths(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(root, "state"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => `state/${name}`)
    .filter(isStatePath)
    .sort();
}

/**
 * Copy each stored row over its file and record what the store held. A row for any other path is
 * ignored (a stray path must not reach `.env`, `Digests/` or outside the checkout); a file with no
 * row is kept, and a push will add it. Returns the paths whose file changed.
 */
export async function pullState(root: string, sql: SqlClient): Promise<string[]> {
  const changed: string[] = [];
  const baseline: Baseline = {};
  for (const row of await readRows(sql)) {
    baseline[row.path] = { version: row.version, content: row.content };
    const file = join(root, row.path);
    if ((await readText(file)) === row.content) continue;
    await writeFileAtomic(file, row.content);
    changed.push(row.path);
  }
  await writeBaseline(root, baseline);
  return changed;
}

/**
 * Create the table and insert each state file that has no row yet. A row that exists is never
 * replaced, so a second run changes nothing. `dryRun` only reports. Returns the paths inserted.
 */
export async function seedState(
  root: string,
  sql: SqlClient,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  if (!options.dryRun) await sql.query(STATE_SCHEMA_SQL);
  const stored = options.dryRun ? await readRows(sql).catch(() => []) : await readRows(sql);
  const have = new Set(stored.map((row) => row.path));
  const written: string[] = [];
  for (const path of await localStatePaths(root)) {
    if (have.has(path)) continue;
    const content = await readText(join(root, path));
    if (content === null) continue;
    if (!options.dryRun) {
      const rows = await sql.query(
        "insert into state_documents (path, content) values ($1, $2) on conflict (path) do nothing returning path",
        [path, content],
      );
      if (rows.length === 0) continue;
    }
    written.push(path);
  }
  return written;
}

/** One write on the version it was read at; the new version, or null when the row moved. */
async function writeAt(
  sql: SqlClient,
  path: string,
  content: string,
  version: number | null,
): Promise<number | null> {
  const rows =
    version === null
      ? await sql.query(
          "insert into state_documents (path, content) values ($1, $2) on conflict (path) do nothing returning version",
          [path, content],
        )
      : await sql.query(
          "update state_documents set content = $2, version = version + 1, updated_at = now() where path = $1 and version = $3 returning version",
          [path, content, version],
        );
  return rows[0] === undefined ? null : Number(rows[0].version);
}

export interface PushResult {
  /** Paths written as this job left them. */
  written: string[];
  /** Paths whose row had moved and was merged with the other job's. */
  merged: string[];
}

/**
 * Send each state file that differs from what the pull left. The write names the version the pull
 * saw, so it lands only if no other job wrote since. If one did, the file's merger combines the two
 * versions; no merger, or one that cannot read a side, throws StateConflictError and the file is
 * not written. Files already written stay written. A merged file is also written to disk, so the
 * checkout matches the store, and the baseline moves to the new versions even when a later file
 * throws.
 */
export async function pushState(
  root: string,
  sql: SqlClient,
  log: Pick<Logger, "info" | "warn"> = { info() {}, warn() {} },
): Promise<PushResult> {
  const baseline = await readBaseline(root);
  const result: PushResult = { written: [], merged: [] };
  try {
    for (const path of await localStatePaths(root)) {
      const mine = await readText(join(root, path));
      const base = baseline[path];
      if (mine === null || mine === base?.content) continue;
      const landed = await pushOne(sql, path, mine, base, result);
      baseline[path] = landed;
      if (landed.content !== mine) await writeFileAtomic(join(root, path), landed.content);
    }
  } finally {
    await writeBaseline(root, baseline);
  }
  for (const path of result.merged) log.info(`state: merged ${path} with a newer write`);
  return result;
}

async function pushOne(
  sql: SqlClient,
  path: string,
  mine: string,
  base: Baseline[string] | undefined,
  result: PushResult,
): Promise<{ version: number; content: string }> {
  let content = mine;
  let version: number | null = base?.version ?? null;
  // The ancestor and this job's file stay what they were: each merge applies this job's change to the newest row.
  const ancestor = base?.content ?? null;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    const landed = await writeAt(sql, path, content, version);
    if (landed !== null) {
      (content === mine ? result.written : result.merged).push(path);
      return { version: landed, content };
    }
    const [row] = await readRows(sql, [path]);
    // The row moved: merge this job's file into what is there now, then try again on that version.
    const merge = stateMergerFor(path);
    if (merge === undefined) {
      throw new StateConflictError(path, "another job wrote it and it has no merge rule");
    }
    const merged =
      row === undefined ? mine : merge({ base: ancestor, upstream: row.content, mine });
    if (merged === null) throw new StateConflictError(path, "a side could not be read to merge");
    content = merged;
    version = row?.version ?? null;
  }
  throw new StateConflictError(path, `still moving after ${PUSH_ATTEMPTS} attempts`);
}
