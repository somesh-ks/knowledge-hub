import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * The owner's switches for the experiments in the admin app: one row per experiment in Neon, read
 * by the engine when a run starts and written by the admin app. A row overrides the `enabled` the
 * experiment's config file holds in git, so switching one costs no commit and no deploy; no row
 * means the file decides. `promoted_at` marks an experiment the owner has accepted as a feature; its
 * flag stays on until the code that holds the switch is deleted. The table is created by its first
 * write. No driver here: see neon.ts.
 */

export const EXPERIMENT_FLAGS_SCHEMA_SQL = [
  `create table if not exists experiment_flags (
  id text primary key,
  enabled boolean not null,
  promoted_at timestamptz,
  updated_at timestamptz not null default now()
)`,
] as const;

export interface ExperimentFlag {
  enabled: boolean;
  /** When the owner promoted it, in epoch milliseconds; null while it is still an experiment. */
  promoted_at: number | null;
}

export type ExperimentFlags = Record<string, ExperimentFlag>;

/** Every stored flag by experiment id. A table that does not exist yet holds none. */
export async function readExperimentFlags(sql: SqlClient): Promise<ExperimentFlags> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(
      "select id, enabled, (extract(epoch from promoted_at) * 1000)::float8 as promoted_at from experiment_flags",
    );
  } catch (error) {
    if (missingTable(error)) return {};
    throw error;
  }
  const flags: ExperimentFlags = {};
  for (const row of rows) {
    flags[String(row.id)] = {
      enabled: row.enabled === true,
      promoted_at: row.promoted_at === null ? null : Number(row.promoted_at),
    };
  }
  return flags;
}

/**
 * Switches an experiment on or off; its promotion, if any, is kept. A promoted experiment stays
 * on, so the write that would turn one off touches no row and throws.
 */
export async function setExperimentEnabled(
  sql: SqlClient,
  id: string,
  enabled: boolean,
): Promise<void> {
  const rows = await withTable(sql, EXPERIMENT_FLAGS_SCHEMA_SQL, () =>
    sql.query(
      `insert into experiment_flags (id, enabled) values ($1, $2)
       on conflict (id) do update set enabled = excluded.enabled, updated_at = now()
       where experiment_flags.promoted_at is null or excluded.enabled
       returning id`,
      [id, enabled],
    ),
  );
  if (rows.length === 0) throw new Error(`${id} is promoted and stays on`);
}

/** Marks an experiment promoted, which also turns it on; `false` takes the mark back (Undo) and keeps its switch. */
export async function setExperimentPromoted(
  sql: SqlClient,
  id: string,
  promoted: boolean,
): Promise<void> {
  await withTable(sql, EXPERIMENT_FLAGS_SCHEMA_SQL, () =>
    sql.query(
      `insert into experiment_flags (id, enabled, promoted_at) values ($1, true, case when $2 then now() end)
       on conflict (id) do update set
         enabled = experiment_flags.enabled or $2,
         promoted_at = case when $2 then now() end,
         updated_at = now()`,
      [id, promoted],
    ),
  );
}
