import { VITAL_METRICS, type VitalDevice, type VitalMetric } from "@singularity/core/vitals";
import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * Field Web Vitals in Neon (D156), in the database the config store and the rate-limit counter use
 * (D149, D150): `/api/report` adds a page's samples, `singularity health` reads each metric's 7-day
 * p75. One row per metric a page measured, holding only its route template, the value, the device
 * class and the connection type. The table stays bounded: every insert deletes what fell out of the
 * window, as does health each day (`pruneVitals`), and an hour takes at most VITALS_ROWS_PER_HOUR
 * rows, so a flood of forged reports fills one hour's share and no more. No driver here: see neon.ts.
 */

/** How long a sample is kept and how far back health reads. */
export const VITALS_WINDOW_DAYS = 7;
/**
 * Rows the last hour may hold, all pages together: about 200 page loads an hour, far above the
 * site's traffic, so it only ever stops a flood.
 */
export const VITALS_ROWS_PER_HOUR = 600;

export const VITALS_SCHEMA_SQL = [
  `create table if not exists web_vitals (
  at timestamptz not null,
  page text not null,
  metric text not null,
  value double precision not null,
  device text not null,
  connection text
)`,
  "create index if not exists web_vitals_at on web_vitals (at)",
] as const;

/** One page's measurements, as the server checked them (apps/web/src/server/report.ts). */
export interface VitalsReport {
  page: string;
  device: VitalDevice;
  connection: string | null;
  values: Partial<Record<VitalMetric, number>>;
}

/**
 * One statement: the rows past the window go, then the page's rows go in unless the last hour would
 * pass its cap. A data-modifying CTE runs whether or not the insert reads it.
 */
const RECORD_SQL = `with gone as (
  delete from web_vitals where at <= to_timestamp($1::float8 / 1000) - $8::int * interval '1 day'
), recent as (
  select count(*) as n from web_vitals where at > to_timestamp($1::float8 / 1000) - interval '1 hour'
)
insert into web_vitals (at, page, metric, value, device, connection)
select to_timestamp($1::float8 / 1000), $2, sample.metric, sample.value, $3, $4
from unnest($5::text[], $6::float8[]) as sample(metric, value), recent
where recent.n + cardinality($5::text[]) <= $7::int
returning 1`;

const PRUNE_SQL = `delete from web_vitals
where at <= to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'`;

const READ_SQL = `select metric, device, count(*)::int as samples,
  percentile_disc(0.75) within group (order by value) as p75
from web_vitals
where at > to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'
group by metric, device`;

/**
 * Stores a page's samples at `now` (epoch ms); the number of rows written, 0 when the hour is full.
 * The first report creates the table, so nothing has to be run by hand first. Throws when the
 * database does; the caller decides what a failure means.
 */
export async function recordVitals(
  sql: SqlClient,
  report: VitalsReport,
  now: number,
  perHour = VITALS_ROWS_PER_HOUR,
): Promise<number> {
  const metrics = VITAL_METRICS.filter((metric) => report.values[metric] !== undefined);
  if (metrics.length === 0) return 0;
  const params = [
    now,
    report.page,
    report.device,
    report.connection,
    metrics,
    metrics.map((metric) => report.values[metric]),
    perHour,
    VITALS_WINDOW_DAYS,
  ];
  return withTable(
    sql,
    VITALS_SCHEMA_SQL,
    async () => (await sql.query(RECORD_SQL, params)).length,
  );
}

/** One metric on one device class over the window: how many samples, and their 75th percentile. */
export interface VitalSummary {
  metric: VitalMetric;
  device: string;
  samples: number;
  p75: number;
}

/**
 * Deletes what is older than the window, so the week the Privacy page promises holds while no new
 * report comes (health's daily read calls it). Throws when the database does.
 */
export async function pruneVitals(sql: SqlClient, now: number): Promise<void> {
  try {
    await sql.query(PRUNE_SQL, [now, VITALS_WINDOW_DAYS]);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

/**
 * Each metric's p75 per device class over the last VITALS_WINDOW_DAYS before `now` (nearest rank,
 * as CrUX reads it). Only reads. No table yet reads as no samples. Throws when the database does.
 */
export async function readVitals(sql: SqlClient, now: number): Promise<VitalSummary[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(READ_SQL, [now, VITALS_WINDOW_DAYS]);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return rows.flatMap((row) => {
    const metric = VITAL_METRICS.find((each) => each === row.metric);
    return metric
      ? [{ metric, device: String(row.device), samples: Number(row.samples), p75: Number(row.p75) }]
      : [];
  });
}
