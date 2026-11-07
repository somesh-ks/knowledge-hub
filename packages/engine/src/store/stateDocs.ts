import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../context.js";
import { stateMergerFor } from "../git/stateMerge.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { CONFIG_DOCUMENT_PATHS, type SqlClient } from "./configPaths.js";
import { missingTable } from "./pgErrors.js";

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

/** Which state files a job may touch: a job with a restricted login sees only its own rows. */
export type StateScope = (path: string) => boolean;

/**
 * The audio job's files: the cost ledger and the legacy count (D381). Its database login can see no
 * other row (row-level security, docs/runbook.md), so its pull and push name these and no more.
 */
const AUDIO_STATE = /^state\/(costs-\d{4}-\d{2}|usage)\.json$/;

/** The files a command's pull and push cover; undefined is all of them. */
export function stateScopeFor(command: string): StateScope | undefined {
  return command === "publish" ? (path) => AUDIO_STATE.test(path) : undefined;
}

/** A file this store may hold. The suggested sources are the config store's (D296), not these. */
export function isStatePath(path: string): boolean {
  return STATE_PATH.test(path) && !CONFIG_PATHS.has(path);
}

/**
 * Files whose merge subtracts the ancestor (the Speechify counter adds what this job added since the
 * pull). Without one, both jobs' shared starting count would be added twice.
 */
const NEEDS_ANCESTOR: ReadonlySet<string> = new Set(["state/usage.json"]);

/** Attempts to land a merged write before giving up; each loses only to another job's write. */
const PUSH_ATTEMPTS = 4;

export class StateConflictError extends Error {
  constructor(readonly conflicts: readonly { path: string; reason: string }[]) {
    super(`state conflict: ${conflicts.map((c) => `${c.path} (${c.reason})`).join("; ")}`);
    this.name = "StateConflictError";
  }
}

/** One file that could not be written, thrown inside pushOne and collected by pushState. */
class FileConflict extends Error {}

interface StoredRow {
  path: string;
  content: string;
  version: number;
}

/**
 * What a pull left: each file's row version and text hash, so a push can tell a change; the text
 * itself only for a file with a merge rule, which needs it as the common ancestor.
 */
type Baseline = Record<string, { version: number; hash: string; content?: string }>;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function baselineOf(row: StoredRow): Baseline[string] {
  return {
    version: row.version,
    hash: sha256(row.content),
    ...(stateMergerFor(row.path) !== undefined ? { content: row.content } : {}),
  };
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The record of the last pull, or null when there is none (or it cannot be read). */
async function readBaseline(root: string): Promise<Baseline | null> {
  const text = await readText(join(root, STATE_BASELINE_PATH));
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Baseline)
      : null;
  } catch {
    return null;
  }
}

/** Whether a pull has left a record here: a job that never pulled has nothing to push. */
export async function hasPullRecord(root: string): Promise<boolean> {
  return (await readBaseline(root)) !== null;
}

async function writeBaseline(root: string, baseline: Baseline): Promise<void> {
  await mkdir(join(root, ".cache"), { recursive: true });
  await writeFileAtomic(join(root, STATE_BASELINE_PATH), `${JSON.stringify(baseline)}\n`);
}

async function readRows(
  sql: SqlClient,
  paths?: readonly string[],
  scope: StateScope = () => true,
): Promise<StoredRow[]> {
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
    .filter((row) => isStatePath(row.path) && scope(row.path));
}

/** The state files in the checkout. */
async function localStatePaths(root: string, scope: StateScope = () => true): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(root, "state"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => `state/${name}`)
    .filter((path) => isStatePath(path) && scope(path))
    .sort();
}

/**
 * Copy each stored row over its file and record what the store held. A row for any other path is
 * ignored (a stray path must not reach `.env`, `Digests/` or outside the checkout); a file with no
 * row is kept, and a push will add it. Returns the paths whose file changed.
 */
export async function pullState(
  root: string,
  sql: SqlClient,
  scope?: StateScope,
): Promise<string[]> {
  const changed: string[] = [];
  const baseline: Baseline = {};
  // The old record goes before any file changes, so it cannot outlive the files it described.
  await rm(join(root, STATE_BASELINE_PATH), { force: true });
  try {
    for (const row of await readRows(sql, undefined, scope)) {
      const file = join(root, row.path);
      if ((await readText(file)) !== row.content) {
        await writeFileAtomic(file, row.content);
        changed.push(row.path);
      }
      baseline[row.path] = baselineOf(row);
    }
    await writeBaseline(root, baseline);
  } catch (error) {
    // A pull that did not finish leaves no record at all: a partial one would let a push treat the
    // files it never reached as new, and merge them without their ancestor.
    await rm(join(root, STATE_BASELINE_PATH), { force: true });
    throw error;
  }
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
  // A dry run may find the table missing; any other failure (permissions, network) must not read as "empty".
  const stored = options.dryRun
    ? await readRows(sql).catch((error: unknown) => {
        if (missingTable(error)) return [];
        throw error;
      })
    : await readRows(sql);
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
 * versions; no merger, or one that cannot read a side, is refused (the file is not written). A
 * conflicting file does not stop the others; the command throws StateConflictError after all are
 * tried. A merged file is also written to disk, so the checkout matches the store. The pull record
 * is dropped first and written back with the new versions once the files match; any other failure
 * leaves none, and the next push refuses until a pull.
 */
export async function pushState(
  root: string,
  sql: SqlClient,
  log: Pick<Logger, "info" | "warn"> = { info() {}, warn() {} },
  scope?: StateScope,
): Promise<PushResult> {
  const baseline = await readBaseline(root);
  // Without a pull there is no ancestor to merge from, and the files here may be older than the rows.
  if (baseline === null) throw new Error("no state pull record here; run `state pull` first");
  // The record is dropped while rows are written and put back once the files match them, so a
  // push that dies half-way cannot be retried against versions it already moved past.
  await rm(join(root, STATE_BASELINE_PATH), { force: true });
  const result: PushResult = { written: [], merged: [] };
  const conflicts: { path: string; reason: string }[] = [];
  for (const path of await localStatePaths(root, scope)) {
    const mine = await readText(join(root, path));
    const base = baseline[path];
    if (mine === null || (base !== undefined && sha256(mine) === base.hash)) continue;
    try {
      const landed = await pushOne(sql, path, mine, base, result, scope);
      if (landed.content !== mine) await writeFileAtomic(join(root, path), landed.content);
      baseline[path] = baselineOf({ path, ...landed });
    } catch (error) {
      // The other files still land: a refused seen.json must not cost the run its costs.
      if (!(error instanceof FileConflict)) throw error;
      conflicts.push({ path, reason: error.message });
    }
  }
  await writeBaseline(root, baseline);
  for (const path of result.merged) log.info(`state: merged ${path} with a newer write`);
  if (conflicts.length > 0) throw new StateConflictError(conflicts);
  return result;
}

async function pushOne(
  sql: SqlClient,
  path: string,
  mine: string,
  base: Baseline[string] | undefined,
  result: PushResult,
  scope?: StateScope,
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
    const [row] = await readRows(sql, [path], scope);
    if (row === undefined) {
      // A row removed since the pull must not be put back at a version another checkout may also
      // hold; the store was reset, so the owner pulls and seeds again.
      if (version !== null) throw new FileConflict("its row was removed since the pull");
      continue;
    }
    // The row moved: merge this job's file into what is there now, then try again on that version.
    const merge = stateMergerFor(path);
    if (merge === undefined)
      throw new FileConflict("another job wrote it and it has no merge rule");
    if (ancestor === null && NEEDS_ANCESTOR.has(path)) {
      throw new FileConflict("another job wrote it and this job pulled before the row existed");
    }
    const merged = merge({ base: ancestor, upstream: row.content, mine });
    if (merged === null) throw new FileConflict("a side could not be read to merge");
    content = merged;
    version = row.version;
  }
  throw new FileConflict(`still moving after ${PUSH_ATTEMPTS} attempts`);
}
