import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../context.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import {
  CONFIG_DOCUMENT_PATHS,
  type ConfigDocument,
  type ConfigDocumentPath,
  type DocumentWrite,
  type SqlClient,
} from "./configPaths.js";

export * from "./configPaths.js";

/**
 * The owner's configuration in Postgres (D149): one row per config file, holding the file's exact
 * text. With the store on (DATABASE_URL and DISPATCH_CONFIG_STORE=postgres), `run` and `podcast`
 * copy the rows over the files before they start, and the run's commit carries them to git as the
 * snapshot. With the store off nothing here is called. No driver here: see neon.ts.
 */

const KNOWN: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);

export const CONFIG_SCHEMA_SQL = `create table if not exists config_documents (
  path text primary key,
  content text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
)`;

/** Every stored document, as the database holds it. */
export async function readConfigDocuments(sql: SqlClient): Promise<ConfigDocument[]> {
  const rows = await sql.query("select path, content, version from config_documents");
  return rows.map((row) => ({
    path: String(row.path),
    content: String(row.content),
    version: Number(row.version),
  }));
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy each stored document over its file. A row whose path is not one of CONFIG_DOCUMENT_PATHS is
 * never written (a stray path must not reach `.env`, `Digests/` or outside the checkout), and a row
 * that is not JSON is skipped so the loaders keep the committed file. A file with no row is kept.
 * Returns the paths whose content changed.
 */
export async function hydrateConfig(root: string, sql: SqlClient, log: Logger): Promise<string[]> {
  const changed: string[] = [];
  for (const document of await readConfigDocuments(sql)) {
    if (!KNOWN.has(document.path)) {
      log.warn(`config store: ignored a row for ${JSON.stringify(document.path)}`);
      continue;
    }
    if (!isJson(document.content)) {
      log.warn(`config store: ${document.path} is not JSON; kept the file`);
      continue;
    }
    const file = join(root, document.path);
    if ((await readText(file)) === document.content) continue;
    await writeFileAtomic(file, document.content);
    changed.push(document.path);
  }
  return changed;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Create the table and insert each config file that has no row yet. A row that exists is never
 * replaced, so a second run, or a run after edits made in the app, changes nothing. `dryRun` only
 * reports what would be inserted. Returns the paths inserted (or that would be).
 */
export async function seedConfigDocuments(
  root: string,
  sql: SqlClient,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  if (!options.dryRun) await sql.query(CONFIG_SCHEMA_SQL);
  const stored = options.dryRun
    ? await readConfigDocuments(sql).catch(() => [])
    : await readConfigDocuments(sql);
  const have = new Set(stored.map((document) => document.path));
  const inserted: string[] = [];
  for (const path of CONFIG_DOCUMENT_PATHS) {
    if (have.has(path)) continue;
    const content = await readText(join(root, path));
    if (content === null) continue;
    if (!options.dryRun) {
      const rows = await sql.query(
        "insert into config_documents (path, content) values ($1, $2) on conflict (path) do nothing returning path",
        [path, content],
      );
      if (rows.length === 0) continue;
    }
    inserted.push(path);
  }
  return inserted;
}

/** When the newest document was written, in epoch milliseconds, or null for an empty store. */
export async function lastConfigWrite(sql: SqlClient): Promise<number | null> {
  const rows = await sql.query(
    "select (extract(epoch from max(updated_at)) * 1000)::float8 as at from config_documents",
  );
  const at = rows[0]?.at;
  return at === null || at === undefined ? null : Number(at);
}

/** Postgres' code for division by zero: the statement below raises it to undo itself. */
const ROLLED_BACK = "22012";

/**
 * Write edited documents only if every one is still at the version it was read at. It is one
 * statement, so one transaction: the rows are locked first (`for update`, which waits for and then
 * sees any write that committed meanwhile), and the last step divides by zero (by a count, never a constant the planner would fold early) unless every document
 * was written, which aborts the statement and undoes all of it. Either every document lands or none
 * does; false means another edit got there first.
 */
export async function writeConfigDocuments(
  sql: SqlClient,
  writes: readonly DocumentWrite[],
): Promise<boolean> {
  if (writes.length === 0) return true;
  for (const write of writes) {
    if (!KNOWN.has(write.path)) throw new Error(`not a config document: ${write.path}`);
  }
  try {
    const rows = await sql.query(
      `with input as (
         select * from unnest($1::text[], $2::text[], $3::int[]) as t(path, content, version)
       ),
       locked as (
         select d.path, d.version from config_documents d
         where d.path = any($1::text[]) for update
       ),
       ok as (
         select not exists (
           select 1 from input i left join locked l on l.path = i.path
           where i.version is distinct from l.version
         ) as fine
       ),
       updated as (
         update config_documents d set content = i.content, version = d.version + 1, updated_at = now()
         from input i, ok where ok.fine and d.path = i.path and i.version is not null
         returning d.path
       ),
       inserted as (
         insert into config_documents (path, content)
         select i.path, i.content from input i, ok where ok.fine and i.version is null
         on conflict (path) do nothing returning path
       )
       select case
         when (select count(*) from updated) + (select count(*) from inserted) = $4::int then $4::int
         else (select count(*) from updated)::int / 0
       end as written`,
      [
        writes.map((write) => write.path),
        writes.map((write) => write.content),
        writes.map((write) => write.version),
        writes.length,
      ],
    );
    return Number(rows[0]?.written) === writes.length;
  } catch (error) {
    if ((error as { code?: unknown }).code === ROLLED_BACK) return false;
    throw error;
  }
}

/** The single document `dispatch learn` writes, on the version it read. */
export async function writeConfigDocument(
  sql: SqlClient,
  path: ConfigDocumentPath,
  content: string,
  version: number | null,
): Promise<boolean> {
  return writeConfigDocuments(sql, [{ path, content, version }]);
}
