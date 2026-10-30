import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * What an experiment in shadow would have added, per pass of a run, kept in Neon beside the owner's
 * switches (store/experimentFlags.ts) so the admin app can show it. A row is one pass's count and may
 * be 0: a shadow that found nothing is evidence too, and no row at all means it has not run yet. Every
 * write deletes what fell out of the window. No driver here: see neon.ts.
 */

/** How far back the admin app reads, and how long a row is kept. */
export const EXPERIMENT_HITS_WINDOW_DAYS = 7;

export const EXPERIMENT_HITS_SCHEMA_SQL = [
  `create table if not exists experiment_hits (
  at timestamptz not null,
  experiment_id text not null,
  pass text not null,
  stories integer not null
)`,
  "create index if not exists experiment_hits_at on experiment_hits (at)",
] as const;

const PRUNE_SQL = `delete from experiment_hits
where at <= to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'`;

/** One pass's count for one experiment. */
export interface ExperimentHit {
  id: string;
  pass: string;
  stories: number;
}

/** The window's total for one experiment, and how many passes it was counted over. */
export interface ExperimentHitTotal {
  stories: number;
  passes: number;
}

/** Stores a run's counts at `now` (epoch ms) and drops the rows past the window. Throws when the database does. */
export async function recordExperimentHits(
  sql: SqlClient,
  hits: readonly ExperimentHit[],
  now: number,
): Promise<void> {
  if (hits.length === 0) {
    // Both lists are on: nothing to add, but what fell out of the window still goes.
    try {
      await sql.query(PRUNE_SQL, [now, EXPERIMENT_HITS_WINDOW_DAYS]);
    } catch (error) {
      if (!missingTable(error)) throw error;
    }
    return;
  }
  await withTable(sql, EXPERIMENT_HITS_SCHEMA_SQL, () =>
    sql.query(
      `with gone as (
  delete from experiment_hits where at <= to_timestamp($1::float8 / 1000) - $5::int * interval '1 day'
)
insert into experiment_hits (at, experiment_id, pass, stories)
select to_timestamp($1::float8 / 1000), hit.id, hit.pass, hit.stories
from unnest($2::text[], $3::text[], $4::int[]) as hit(id, pass, stories)`,
      [
        now,
        hits.map((hit) => hit.id),
        hits.map((hit) => hit.pass),
        hits.map((hit) => hit.stories),
        EXPERIMENT_HITS_WINDOW_DAYS,
      ],
    ),
  );
}

/** Each experiment's window total; an experiment with no row has not run in shadow. A table that does not exist yet holds none. */
export async function readExperimentHits(
  sql: SqlClient,
  now: number,
): Promise<Record<string, ExperimentHitTotal>> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(
      `select experiment_id, sum(stories)::int as stories, count(*)::int as passes
from experiment_hits
where at > to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'
group by experiment_id`,
      [now, EXPERIMENT_HITS_WINDOW_DAYS],
    );
  } catch (error) {
    if (missingTable(error)) return {};
    throw error;
  }
  const totals: Record<string, ExperimentHitTotal> = {};
  for (const row of rows) {
    totals[String(row.experiment_id)] = {
      stories: Number(row.stories),
      passes: Number(row.passes),
    };
  }
  return totals;
}
