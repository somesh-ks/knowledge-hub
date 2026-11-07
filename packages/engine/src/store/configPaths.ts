/**
 * The config store's names and switch (D149), with no database code: the CLI, the write guard and
 * the site's route import this, so it loads no Neon driver itself; `connectConfigStore` does, on
 * call (the config store, D149, and the site's rate-limit counter whenever DATABASE_URL is set, D150).
 */

/**
 * The files the database may hold, and the only paths a row may ever be written to. They are the
 * owner's own config and are not in git (D296); `config/examples` holds the public defaults.
 */
export const CONFIG_DOCUMENT_PATHS = [
  "config/topics.json",
  "config/sources.user.json",
  "config/queries.json",
  "config/preferences.json",
  "config/schedule.json",
  "config/structure.json",
  "config/writer.json",
  "config/profiles/owner.json",
  // Suggested sources: topic.remove drops a removed topic's, so they live beside the topics.
  "state/source-candidates.json",
] as const;

export type ConfigDocumentPath = (typeof CONFIG_DOCUMENT_PATHS)[number];

/** What the store needs from a SQL client: one parameterised query, rows back as objects. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface ConfigDocument {
  path: string;
  content: string;
  version: number;
  /** When it was last written, in epoch milliseconds (absent from a test's fake rows). */
  updatedAt?: number;
}

export interface DocumentWrite {
  path: string;
  content: string;
  /** The version the edit was made on; null for a document the store does not hold yet. */
  version: number | null;
}

/** The URL to use when the store is switched on, or null: the URL alone never turns it on. */
export function configStoreUrl(env: {
  DATABASE_URL?: string | undefined;
  SINGULARITY_CONFIG_STORE?: string | undefined;
}): string | null {
  const store = env.SINGULARITY_CONFIG_STORE;
  return env.DATABASE_URL !== undefined && env.DATABASE_URL !== "" && store === "postgres"
    ? env.DATABASE_URL
    : null;
}

/**
 * The URL to use when the run state store is switched on, or null (D381). Its own switch, beside
 * the config store's, so state can be turned on and off without touching the owner's config.
 */
export function stateStoreUrl(env: {
  DATABASE_URL?: string | undefined;
  SINGULARITY_STATE_STORE?: string | undefined;
}): string | null {
  return env.DATABASE_URL !== undefined &&
    env.DATABASE_URL !== "" &&
    env.SINGULARITY_STATE_STORE === "postgres"
    ? env.DATABASE_URL
    : null;
}

/** The URL and its password, decoded: an error that names either must be logged without it. */
export function databaseSecrets(databaseUrl: string): string[] {
  try {
    return [databaseUrl, decodeURIComponent(new URL(databaseUrl).password)];
  } catch {
    return [databaseUrl];
  }
}

/** Opens the store over Neon's HTTP driver, which is loaded only on this call. */
export async function connectConfigStore(databaseUrl: string): Promise<SqlClient> {
  const { connectNeon } = await import("./neon.js");
  return connectNeon(databaseUrl);
}

/**
 * Whether a command reads the owner's config at its start: a whole run or the gate stage that opens
 * one (the later stages of the same run, and its failure record, keep what the gate copied), the
 * weekly podcast, ingest, which reads the sources the owner has now (D233), and `health`, which
 * checks the config. Not `publish` (audio.yml): that job has no database access by design (SEC-03).
 */
export function readsConfigAtStart(command: string, argv: readonly string[]): boolean {
  if (command === "podcast" || command === "ingest") return true;
  if (command === "health") return true;
  if (command !== "run") return false;
  // A run's failure record commits after the gate copied the store; it must leave the gate's note.
  if (argv.includes("--record-failed")) return false;
  const at = argv.findIndex((arg) => arg === "--stage" || arg.startsWith("--stage="));
  if (at === -1) return true;
  const flag = argv[at] ?? "";
  const stage = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv[at + 1];
  return stage === "gate";
}

/**
 * Whether a command copies the run state (state/*.json) from the store at its start (D381). The
 * same commands as the config, except that a podcast does it in its first stage only: its later
 * stages run in the same checkout and hold spend and timings that are not committed yet, which a
 * second pull would write over.
 */
export function readsStateAtStart(command: string, argv: readonly string[]): boolean {
  // The audio job reads no config (SEC-03) but pulls its cost rows through its own login.
  if (command === "publish") return true;
  if (!readsConfigAtStart(command, argv)) return false;
  if (command !== "podcast") return true;
  const at = argv.findIndex((arg) => arg === "--stage" || arg.startsWith("--stage="));
  if (at === -1) return true;
  const flag = argv[at] ?? "";
  const stage = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv[at + 1];
  return stage === "select";
}
