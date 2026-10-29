import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * Every generation run in Neon (D220): one row in `pipeline_runs` and one per stage in
 * `pipeline_stages`, written by the engine when a run ends, whatever its end (published, nothing,
 * failed) and whatever its kind (a dry run, a regeneration, a Catch up). It is the measuring layer
 * of the store-as-truth plan: timings and cost per stage that the committed run metrics and the
 * cost ledger only hold for runs that published, and that Health reads without opening git.
 * Writes are best effort and idempotent (a run id is written again with its newer end); the first
 * write creates the tables. No driver here: see neon.ts.
 */

export const RUNS_SCHEMA_SQL = [
  `create table if not exists pipeline_runs (
  run_id text primary key,
  workflow text not null,
  kind text not null,
  mode text not null,
  replaces text,
  dry_run boolean not null,
  outcome text not null,
  podcasts text[] not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  work_ms integer not null,
  total_ms integer not null,
  usd double precision not null,
  failure_stage text,
  failure_reason text,
  github_run_id text
)`,
  "create index if not exists pipeline_runs_started on pipeline_runs (started_at)",
  `create table if not exists pipeline_stages (
  run_id text not null,
  stage text not null,
  ms integer not null,
  usd double precision not null,
  primary key (run_id, stage)
)`,
] as const;

export type RunOutcome = "published" | "nothing" | "failed" | "cancelled";

/** One stage of a run: its wall time and what its paid calls cost, priced from config/prices.json. */
export interface StageRecord {
  stage: string;
  ms: number;
  usd: number;
}

export interface RunRecord {
  /** The cost ledger's run id (the plan's `created_at`, or an episode id), so the two join. */
  run_id: string;
  /** `run` (run.yml) or `podcast` (podcast.yml). */
  workflow: "run" | "podcast";
  /** The ledger's kind: daily, weekly, on_demand or catch_up. */
  kind: string;
  mode: string;
  /** The digest or episode this run replaced, for a regeneration. */
  replaces: string | null;
  dry_run: boolean;
  outcome: RunOutcome;
  /** The digest or episode ids the run made (or tried to). */
  podcasts: readonly string[];
  started_at: string;
  finished_at: string;
  /** The stages' time added up: generation, without the wait for the publish time. */
  work_ms: number;
  /** Start to finish, the wait for the publish time included. */
  total_ms: number;
  usd: number;
  failure: { stage: string; reason: string } | null;
  /** GITHUB_RUN_ID, to open the run's log from a row. */
  github_run_id: string | null;
  stages: readonly StageRecord[];
}

const RUN_SQL = `insert into pipeline_runs (run_id, workflow, kind, mode, replaces, dry_run, outcome,
  podcasts, started_at, finished_at, work_ms, total_ms, usd, failure_stage, failure_reason, github_run_id)
values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15, $16)
on conflict (run_id) do update set
  started_at = least(pipeline_runs.started_at, excluded.started_at),
  kind = excluded.kind, mode = excluded.mode, replaces = excluded.replaces,
  dry_run = excluded.dry_run, outcome = excluded.outcome, podcasts = excluded.podcasts,
  finished_at = excluded.finished_at, work_ms = excluded.work_ms,
  total_ms = greatest(excluded.total_ms, (extract(epoch from excluded.finished_at
    - least(pipeline_runs.started_at, excluded.started_at)) * 1000)::int),
  usd = excluded.usd, failure_stage = excluded.failure_stage,
  failure_reason = excluded.failure_reason, github_run_id = excluded.github_run_id`;

const STAGES_SQL = `insert into pipeline_stages (run_id, stage, ms, usd)
select $1, stage.name, stage.ms, stage.usd
from unnest($2::text[], $3::int[], $4::float8[]) as stage(name, ms, usd)
on conflict (run_id, stage) do update set ms = excluded.ms, usd = excluded.usd`;

/** Whole milliseconds, never negative, and inside Postgres' integer. */
const wholeMs = (value: number): number =>
  Math.min(2_147_483_647, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

/**
 * Stores a finished run and its stages. Writing the same run again replaces it, so a retry or a
 * second end (a failure record after a commit) keeps one row. Throws when the database does; the
 * caller decides what a failure means (the engine only warns).
 */
export async function recordPipelineRun(sql: SqlClient, run: RunRecord): Promise<void> {
  await withTable(sql, RUNS_SCHEMA_SQL, async () => {
    await sql.query(RUN_SQL, [
      run.run_id,
      run.workflow,
      run.kind,
      run.mode,
      run.replaces,
      run.dry_run,
      run.outcome,
      [...run.podcasts],
      run.started_at,
      run.finished_at,
      wholeMs(run.work_ms),
      wholeMs(run.total_ms),
      Math.round(run.usd * 1e6) / 1e6,
      run.failure?.stage ?? null,
      run.failure?.reason.slice(0, 280) ?? null,
      run.github_run_id,
    ]);
    if (run.stages.length > 0) {
      await sql.query(STAGES_SQL, [
        run.run_id,
        run.stages.map((stage) => stage.stage),
        run.stages.map((stage) => wholeMs(stage.ms)),
        run.stages.map((stage) => Math.round(stage.usd * 1e6) / 1e6),
      ]);
    }
  });
}

/** One stage's time over a window: the median and the slowest tenth of its runs, and its cost. */
export interface StageTiming {
  workflow: string;
  kind: string;
  stage: string;
  runs: number;
  p50_ms: number;
  p90_ms: number;
  avg_usd: number;
}

const TIMINGS_SQL = `select r.workflow, r.kind, s.stage, count(*)::int as runs,
  percentile_disc(0.5) within group (order by s.ms) as p50_ms,
  percentile_disc(0.9) within group (order by s.ms) as p90_ms,
  avg(s.usd) as avg_usd
from pipeline_stages s join pipeline_runs r using (run_id)
where r.started_at > to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'
  and r.dry_run = false and r.outcome in ('published', 'nothing')
group by r.workflow, r.kind, s.stage
order by r.workflow, r.kind, s.stage`;

/**
 * Each stage's median and p90 time over the last `days` before `now` (epoch ms), per workflow and
 * kind, from runs that finished: a dry run is a test of the pipeline and a failed or cancelled run stops
 * early, so none says how long a stage takes. No table yet reads as no runs. Throws when the database does.
 */
export async function readStageTimings(
  sql: SqlClient,
  now: number,
  days = 14,
): Promise<StageTiming[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(TIMINGS_SQL, [now, days]);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return rows.map((row) => ({
    workflow: String(row.workflow),
    kind: String(row.kind),
    stage: String(row.stage),
    runs: Number(row.runs),
    p50_ms: Number(row.p50_ms),
    p90_ms: Number(row.p90_ms),
    avg_usd: Number(row.avg_usd),
  }));
}
