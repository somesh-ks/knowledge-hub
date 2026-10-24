/**
 * The config store's names and switch (D149), with no database code: the CLI, the write guard and
 * the site's route import this, so it loads no Neon driver itself; `connectConfigStore` does, on
 * call (the config store, D149, and the site's rate-limit counter whenever DATABASE_URL is set, D150).
 */

/** The files the database may hold, and the only paths a row may ever be written to. */
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
  DISPATCH_CONFIG_STORE?: string | undefined;
}): string | null {
  const store = env.SINGULARITY_CONFIG_STORE ?? env.DISPATCH_CONFIG_STORE;
  return env.DATABASE_URL !== undefined && env.DATABASE_URL !== "" && store === "postgres"
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
 * one (the later stages of the same run, and its failure record, keep what the gate copied), and the
 * weekly podcast.
 */
export function readsConfigAtStart(command: string, argv: readonly string[]): boolean {
  if (command === "podcast") return true;
  if (command !== "run") return false;
  // A run's failure record commits after the gate copied the store; it must leave the gate's note.
  if (argv.includes("--record-failed")) return false;
  const at = argv.findIndex((arg) => arg === "--stage" || arg.startsWith("--stage="));
  if (at === -1) return true;
  const flag = argv[at] ?? "";
  const stage = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv[at + 1];
  return stage === "gate";
}
