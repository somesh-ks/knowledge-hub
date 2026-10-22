import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../context.js";
import { writeFileAtomic } from "../state/atomicWrite.js";

/**
 * The owner's configuration in Postgres (D149): one row per config file, holding the file's exact
 * text. With the store on (DATABASE_URL and DISPATCH_CONFIG_STORE=postgres), `run` and `podcast`
 * copy the rows over the files before they start, and the run's commit carries them to git as the
 * snapshot. With the store off nothing here is called.
 */

/** The files the database may hold, and the only paths a row may ever be written to. */
export const CONFIG_DOCUMENT_PATHS = [
  "config/topics.json",
  "config/sources.user.json",
  "config/queries.json",
  "config/preferences.json",
  "config/schedule.json",
  "config/writer.json",
  "config/profiles/owner.json",
] as const;

const KNOWN: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);

/** What the module needs from a SQL client: one parameterised query, rows back as objects. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export const CONFIG_SCHEMA_SQL = `create table if not exists config_documents (
  path text primary key,
  content text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
)`;

export interface ConfigDocument {
  path: string;
  content: string;
  version: number;
}

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

/** The driver's package, named in a variable so the engine typechecks and runs without it installed. */
const NEON_DRIVER = "@neondatabase/serverless";

/** A client over Neon's HTTP endpoint: one fetch per query, nothing to close. */
export async function connectConfigStore(databaseUrl: string): Promise<SqlClient> {
  const driver = (await import(NEON_DRIVER)) as {
    neon: (url: string) => {
      query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
  };
  const sql = driver.neon(databaseUrl);
  return { query: (text, params) => sql.query(text, params ?? []) };
}

/**
 * Whether a command reads the owner's config at its start: a whole run or the gate stage that opens
 * one (the later stages of the same run keep what the gate copied), and the weekly podcast.
 */
export function readsConfigAtStart(command: string, argv: readonly string[]): boolean {
  if (command === "podcast") return true;
  if (command !== "run") return false;
  const at = argv.findIndex((arg) => arg === "--stage" || arg.startsWith("--stage="));
  if (at === -1) return true;
  const flag = argv[at] ?? "";
  const stage = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv[at + 1];
  return stage === "gate";
}
